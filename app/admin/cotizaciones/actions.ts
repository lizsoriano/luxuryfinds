"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { businessToday, formatDate, formatMoney, PAYMENT_METHODS } from "../../../lib/format";
import { getStockFor } from "../../../lib/supabase/admin-catalog";
import { getOpenCashSession } from "../../../lib/supabase/admin-commerce";
import { getQuoteDetail, type QuoteDetail, type QuoteItemRow } from "../../../lib/supabase/admin-quotes";
import { DEFAULT_BUSINESS_ID, adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";
import { sendTelegramMessage } from "../../../lib/telegram/send";
import { createManualOrderAction } from "../pedidos/actions";

function revalidate(quoteId?: string, clientId?: string) {
  revalidatePath("/admin/cotizaciones");
  if (quoteId) revalidatePath(`/admin/cotizaciones/${quoteId}`);
  if (clientId) revalidatePath(`/admin/clientes/${clientId}`);
  revalidatePath("/admin/clientes");
}

/**
 * lib/actions.ts#describeError points every "relation does not exist" at
 * migration 002, which would send the owner to the wrong file for this module.
 */
function describeQuoteError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("Could not find the")
  ) {
    return "Falta aplicar database/migrations/007_quotes.sql en el editor SQL de Supabase.";
  }
  return describeError(error, fallback);
}

/** Telegram messages are sent with parse_mode HTML, so free text must be escaped. */
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type QuoteCartLine = { variantId: string; quantity: number };

export type CreateQuoteResult = { success: true; quoteId: string } | { success: false; error: string };

/**
 * Mirrors createManualOrderAction's contract (a direct call from the client
 * component, not a form action) because the "Nueva cotización" screen is the
 * same picker/cart form as "Nuevo pedido" and needs the new id to navigate to.
 * Prices are read from the database, never from the browser, and snapshotted
 * into quote_items: that snapshot IS the quote.
 */
export async function createQuoteAction(
  clientId: string,
  cart: QuoteCartLine[],
  validUntil: string,
  notes?: string,
): Promise<CreateQuoteResult> {
  try {
    const actor = await requireAdminActor();
    if (!clientId) return { success: false, error: "Elige una clienta." };
    if (!cart.length) return { success: false, error: "Agrega al menos un artículo." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { success: false, error: "Elige hasta cuándo es válida la cotización." };
    if (validUntil < businessToday()) return { success: false, error: "La vigencia no puede ser una fecha pasada." };

    // Two lines for the same variant would quote the same thing twice; the form
    // already merges them, this keeps a hand-built payload honest too.
    const merged = new Map<string, number>();
    for (const line of cart) {
      if (!line.variantId || !Number.isInteger(line.quantity) || line.quantity <= 0) {
        return { success: false, error: "Un artículo de la cotización no es válido." };
      }
      merged.set(line.variantId, (merged.get(line.variantId) ?? 0) + line.quantity);
    }

    const db = adminDb();
    const { data: client, error: clientError } = await db.from("clients").select("id, status").eq("id", clientId).maybeSingle();
    if (clientError) return { success: false, error: describeQuoteError(new Error(clientError.message), "No fue posible leer la clienta.") };
    if (!client) return { success: false, error: "Clienta no encontrada." };
    if (client.status !== "ACTIVE") return { success: false, error: "Esta clienta no está activa." };

    const variantIds = [...merged.keys()];
    const { data: variants, error: variantsError } = await db
      .from("product_variants")
      .select("id, price_cents, is_active, product_id, products(name, is_active)")
      .in("id", variantIds);
    if (variantsError) return { success: false, error: describeQuoteError(new Error(variantsError.message), "No fue posible leer los productos.") };
    if (!variants || variants.length !== variantIds.length) return { success: false, error: "Algún artículo ya no existe." };

    type VariantRow = { id: string; price_cents: number; is_active: boolean; product_id: string; products: { name: string; is_active: boolean } | Array<{ name: string; is_active: boolean }> | null };
    const rows = variants as unknown as VariantRow[];
    for (const row of rows) {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      if (!row.is_active || !product?.is_active) {
        return { success: false, error: `"${product?.name ?? "Un artículo"}" ya no está activo y no se puede cotizar.` };
      }
    }
    const byId = new Map(rows.map((row) => [row.id, row]));

    const { data: quote, error: quoteError } = await db
      .from("quotes")
      .insert({
        client_id: clientId,
        status: "DRAFT",
        valid_until: validUntil,
        created_by_admin_id: actor.id,
        notes: notes?.trim() || null,
      })
      .select("id")
      .single();
    if (quoteError || !quote) {
      return { success: false, error: describeQuoteError(new Error(quoteError?.message ?? "error desconocido"), "No fue posible crear la cotización.") };
    }

    const quoteId = quote.id as string;
    const { error: itemsError } = await db.from("quote_items").insert(
      [...merged.entries()].map(([variantId, quantity]) => {
        const variant = byId.get(variantId)!;
        return {
          quote_id: quoteId,
          product_id: variant.product_id,
          variant_id: variantId,
          quantity,
          unit_price_cents: variant.price_cents,
        };
      }),
    );
    if (itemsError) {
      await db.from("quotes").delete().eq("id", quoteId);
      return { success: false, error: describeQuoteError(new Error(itemsError.message), "No fue posible registrar los artículos de la cotización.") };
    }

    await logActivity({
      adminUserId: actor.id,
      action: "QUOTE_CREATED",
      entityType: "quotes",
      entityId: quoteId,
      newData: { clientId, items: merged.size, validUntil },
    });
    revalidate(quoteId, clientId);
    return { success: true, quoteId };
  } catch (error) {
    return { success: false, error: describeQuoteError(error, "No fue posible crear la cotización.") };
  }
}

/** DRAFT and SENT are the two states in which a quote is still live. */
function openQuoteGuard(status: string): string | null {
  if (status === "CONVERTED") return "Esta cotización ya se convirtió y no admite más cambios.";
  if (status === "CANCELLED") return "Esta cotización está cancelada.";
  return null;
}

function quoteTelegramMessage(detail: QuoteDetail) {
  const lines = detail.items.map((item) => {
    const name = escapeHtml(item.productName ?? "Producto");
    const variant = item.variantName ? ` · ${escapeHtml(item.variantName)}` : "";
    return `• ${name}${variant}\n   ${item.quantity} × ${formatMoney(item.unit_price_cents)} = ${formatMoney(item.unit_price_cents * item.quantity)}`;
  });
  return [
    "💌 <b>Tu cotización de Luxury Finds</b>",
    "",
    ...lines,
    "",
    `<b>Total: ${formatMoney(detail.totalCents)}</b>`,
    `Precios válidos hasta el ${formatDate(detail.quote.valid_until)}.`,
    detail.quote.notes ? `\n${escapeHtml(detail.quote.notes)}` : "",
    "\nSi quieres apartarlo, respóndeme por aquí y lo dejamos listo. 🤍",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * "Enviar a la clienta" marks the quote SENT and pushes it over Telegram when
 * the client has linked her chat (migration 001). Telegram is best-effort, like
 * every other notification in this app: a bot outage must not leave the quote
 * stuck in DRAFT, and a client with no linked chat is a normal case the owner
 * handles over WhatsApp — so both are reported in the success message instead
 * of failing the action.
 */
export async function sendQuoteAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const quoteId = String(formData.get("id") ?? "");
    if (!quoteId) return failure("Cotización no encontrada.");

    const detail = await getQuoteDetail(quoteId);
    if (!detail) return failure("Cotización no encontrada.");
    const blocked = openQuoteGuard(detail.quote.status);
    if (blocked) return failure(blocked);
    if (!detail.items.length) return failure("Esta cotización no tiene artículos.");

    const db = adminDb();
    const { error: updateError } = await db
      .from("quotes")
      .update({ status: "SENT", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", quoteId);
    if (updateError) return failure(describeQuoteError(new Error(updateError.message), "No fue posible marcar la cotización como enviada."));

    let telegramNote = " La clienta no tiene Telegram vinculado, avísale por otro medio.";
    if (detail.client?.telegram_chat_id) {
      let sent = false;
      try {
        sent = await sendTelegramMessage(detail.client.telegram_chat_id, quoteTelegramMessage(detail));
      } catch {
        sent = false;
      }
      telegramNote = sent
        ? " Se envió por Telegram."
        : " No fue posible enviarla por Telegram, avísale por otro medio.";
    }

    await logActivity({
      adminUserId: actor.id,
      action: "QUOTE_SENT",
      entityType: "quotes",
      entityId: quoteId,
      newData: { telegram: Boolean(detail.client?.telegram_chat_id) },
    });
    revalidate(quoteId, detail.quote.client_id);
    return ok(`Cotización marcada como enviada.${telegramNote}`);
  } catch (error) {
    return failure(describeQuoteError(error, "No fue posible enviar la cotización."));
  }
}

/** Rebuilds the cart the conversion actions hand to the pedido/venta writers. */
function conversionLines(items: QuoteItemRow[]) {
  return items.map((item) => ({
    variantId: item.variant_id as string,
    quantity: item.quantity,
    unitPriceCents: item.unit_price_cents,
    label: `${item.productName ?? "Producto"}${item.variantName ? ` · ${item.variantName}` : ""}`,
  }));
}

function missingCatalogRow(items: QuoteItemRow[]): string | null {
  for (const item of items) {
    if (!item.variant_id || !item.product_id) {
      return `"${item.productName ?? "Un artículo"}" ya no existe en el catálogo. Crea la cotización de nuevo o cancélala.`;
    }
  }
  return null;
}

/**
 * Convert to pedido. The pedido itself is written by createManualOrderAction —
 * the same function /admin/pedidos/nuevo uses — so client/product/variant
 * validation lives in exactly one place and cannot drift. The one thing done
 * afterwards is re-applying the QUOTED prices: createManualOrderAction snapshots
 * today's catalogue price, but a quote is a price promise, so the pedido has to
 * honour what the client was actually shown.
 */
export async function convertQuoteToOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const quoteId = String(formData.get("id") ?? "");
    if (!quoteId) return failure("Cotización no encontrada.");

    const detail = await getQuoteDetail(quoteId);
    if (!detail) return failure("Cotización no encontrada.");
    const blocked = openQuoteGuard(detail.quote.status);
    if (blocked) return failure(blocked);
    if (!detail.items.length) return failure("Esta cotización no tiene artículos.");
    const missing = missingCatalogRow(detail.items);
    if (missing) return failure(missing);

    const lines = conversionLines(detail.items);
    const result = await createManualOrderAction(
      detail.quote.client_id,
      lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      "FULL",
    );
    if (!result.success) return failure(result.error);

    const db = adminDb();
    let repricedCount = 0;
    let repriceWarning = "";
    for (const line of lines) {
      const { error: repriceError, count } = await db
        .from("order_items")
        .update({ unit_price_cents: line.unitPriceCents }, { count: "exact" })
        .eq("order_id", result.orderId)
        .eq("variant_id", line.variantId)
        .neq("unit_price_cents", line.unitPriceCents);
      if (repriceError) {
        repriceWarning = " Revisa los precios del pedido: no fue posible copiar todos los precios cotizados.";
        break;
      }
      repricedCount += count ?? 0;
    }

    const { error: quoteError } = await db
      .from("quotes")
      .update({
        status: "CONVERTED",
        converted_at: new Date().toISOString(),
        converted_order_id: result.orderId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);
    if (quoteError) {
      return failure(
        `El pedido ${result.orderId.slice(0, 8).toUpperCase()} se creó, pero no fue posible marcar la cotización como convertida (${quoteError.message}).`,
      );
    }

    await logActivity({
      adminUserId: actor.id,
      action: "QUOTE_CONVERTED_TO_ORDER",
      entityType: "quotes",
      entityId: quoteId,
      newData: { orderId: result.orderId, repricedItems: repricedCount },
    });
    revalidate(quoteId, detail.quote.client_id);
    return ok(
      `Cotización convertida en el pedido ${result.orderId.slice(0, 8).toUpperCase()} (en borrador). Confírmalo desde su detalle para generar los tickets.${
        repricedCount ? ` Se respetaron los precios cotizados en ${repricedCount} artículo(s) cuyo precio de catálogo cambió.` : ""
      }${repriceWarning}`,
    );
  } catch (error) {
    return failure(describeQuoteError(error, "No fue posible convertir la cotización en pedido."));
  }
}

/**
 * Convert to venta. This writes the same three things createSaleAction writes
 * (sales + sale_items + an ALLOCATION per line in inventory_movements) but at
 * the QUOTED unit price rather than today's catalogue price, which is the whole
 * point of having quoted it — so it cannot simply delegate to that action.
 * Everything else follows it exactly, including attaching the sale to the open
 * cash drawer when there is one. A sale with no open drawer is allowed (that is
 * how createSaleAction behaves) but is called out in the message, because it
 * will not show up in that day's cash count.
 */
export async function convertQuoteToSaleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const quoteId = String(formData.get("id") ?? "");
    if (!quoteId) return failure("Cotización no encontrada.");
    const paymentMethod = String(formData.get("paymentMethod") ?? "CASH");
    if (!PAYMENT_METHODS.includes(paymentMethod as (typeof PAYMENT_METHODS)[number])) {
      return failure("Método de pago no válido.");
    }

    const detail = await getQuoteDetail(quoteId);
    if (!detail) return failure("Cotización no encontrada.");
    const blocked = openQuoteGuard(detail.quote.status);
    if (blocked) return failure(blocked);
    if (!detail.items.length) return failure("Esta cotización no tiene artículos.");
    const missing = missingCatalogRow(detail.items);
    if (missing) return failure(missing);
    if (!detail.client) return failure("Clienta no encontrada.");
    if (detail.client.status !== "ACTIVE") return failure("Esta clienta no está activa.");

    for (const item of detail.items) {
      if (!item.productActive || !item.variantActive) {
        return failure(`"${item.productName ?? "Un artículo"}" ya no está activo y no se puede vender.`);
      }
    }

    const lines = conversionLines(detail.items);
    const stock = await getStockFor(lines.map((line) => line.variantId));
    for (const line of lines) {
      const available = stock.get(line.variantId) ?? 0;
      if (available < line.quantity) {
        return failure(
          `No hay existencia suficiente de "${line.label}": disponible ${available}, cotizado ${line.quantity}. Conviértela en pedido si hay que encargarla.`,
        );
      }
    }

    const db = adminDb();
    const session = await getOpenCashSession();
    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

    const { data: sale, error: saleError } = await db
      .from("sales")
      .insert({
        business_id: DEFAULT_BUSINESS_ID,
        sale_type: "PRODUCT",
        status: "COMPLETED",
        client_id: detail.quote.client_id,
        cash_session_id: session?.id ?? null,
        concept: null,
        subtotal_cents: subtotalCents,
        discount_cents: 0,
        total_cents: subtotalCents,
        payment_method: paymentMethod,
        notes: `Cotización ${quoteId.slice(0, 8).toUpperCase()}`,
        created_by_admin_id: actor.id,
      })
      .select("id, sale_number")
      .single();
    if (saleError) return failure(describeQuoteError(new Error(saleError.message), "No fue posible registrar la venta."));

    const saleId = sale.id as string;
    const { error: itemsError } = await db.from("sale_items").insert(
      detail.items.map((item) => ({
        sale_id: saleId,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name_snapshot: item.productName ?? "Producto",
        variant_name_snapshot: item.variantName,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        unit_cost_cents: item.costCents,
        total_cents: item.unit_price_cents * item.quantity,
      })),
    );
    if (itemsError) {
      await db.from("sales").delete().eq("id", saleId);
      return failure(describeQuoteError(new Error(itemsError.message), "No fue posible registrar los productos vendidos."));
    }

    const { error: movementError } = await db.from("inventory_movements").insert(
      lines.map((line) => ({
        variant_id: line.variantId,
        movement_type: "ALLOCATION",
        quantity_delta: -line.quantity,
        sale_id: saleId,
        reason: `Venta desde cotización ${sale.sale_number}`,
        created_by_admin_id: actor.id,
      })),
    );
    if (movementError) {
      await db.from("sale_items").delete().eq("sale_id", saleId);
      await db.from("sales").delete().eq("id", saleId);
      return failure(describeQuoteError(new Error(movementError.message), "No fue posible descontar el inventario."));
    }

    const { error: quoteError } = await db
      .from("quotes")
      .update({
        status: "CONVERTED",
        converted_at: new Date().toISOString(),
        converted_sale_id: saleId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);
    if (quoteError) {
      return failure(
        `La venta ${sale.sale_number} se registró, pero no fue posible marcar la cotización como convertida (${quoteError.message}).`,
      );
    }

    await logActivity({
      adminUserId: actor.id,
      action: "QUOTE_CONVERTED_TO_SALE",
      entityType: "quotes",
      entityId: quoteId,
      newData: { saleId, sale_number: sale.sale_number, total_cents: subtotalCents },
    });
    revalidatePath("/admin/vender");
    revalidatePath("/admin/balance");
    revalidatePath("/admin/inventario");
    revalidate(quoteId, detail.quote.client_id);
    return ok(
      `Cotización convertida en la venta ${sale.sale_number}.${
        session ? "" : " No hay una caja abierta, así que esta venta no entra en el corte de caja de hoy."
      }`,
    );
  } catch (error) {
    return failure(describeQuoteError(error, "No fue posible convertir la cotización en venta."));
  }
}

export async function cancelQuoteAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const quoteId = String(formData.get("id") ?? "");
    if (!quoteId) return failure("Cotización no encontrada.");

    const db = adminDb();
    const { data: quote, error: quoteError } = await db
      .from("quotes")
      .select("id, status, client_id")
      .eq("id", quoteId)
      .maybeSingle();
    if (quoteError) return failure(describeQuoteError(new Error(quoteError.message), "No fue posible leer la cotización."));
    if (!quote) return failure("Cotización no encontrada.");
    const blocked = openQuoteGuard(quote.status as string);
    if (blocked) return failure(blocked);

    const { error: cancelError } = await db
      .from("quotes")
      .update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", quoteId);
    if (cancelError) return failure(describeQuoteError(new Error(cancelError.message), "No fue posible cancelar la cotización."));

    await logActivity({ adminUserId: actor.id, action: "QUOTE_CANCELLED", entityType: "quotes", entityId: quoteId });
    revalidate(quoteId, quote.client_id as string);
    return ok("Cotización cancelada.");
  } catch (error) {
    return failure(describeQuoteError(error, "No fue posible cancelar la cotización."));
  }
}
