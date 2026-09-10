"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { parseMoneyToCents } from "../../../lib/format";
import { computeExpectedCash, getOpenCashSession } from "../../../lib/supabase/admin-commerce";
import { getStockFor } from "../../../lib/supabase/admin-catalog";
import {
  DEFAULT_BUSINESS_ID,
  EXPENSE_RECEIPT_BUCKET,
  adminDb,
  adminStorage,
  logActivity,
  requireAdminActor,
} from "../../../lib/supabase/business";

const PAYMENT_METHODS = ["CASH", "TRANSFER", "PAYMENT_LINK"];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function revalidate() {
  revalidatePath("/admin/vender");
  revalidatePath("/admin/balance");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/productos");
}

type CartLine = { variantId: string; quantity: number };

function parseCart(raw: FormDataEntryValue | null): { items: CartLine[]; error: string | null } {
  if (typeof raw !== "string" || !raw.trim()) return { items: [], error: "La canasta está vacía." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], error: "No fue posible leer la canasta." };
  }
  if (!Array.isArray(parsed) || !parsed.length) return { items: [], error: "La canasta está vacía." };

  const items: CartLine[] = [];
  for (const entry of parsed) {
    const variantId = String((entry as { variantId?: unknown }).variantId ?? "");
    const quantity = Number((entry as { quantity?: unknown }).quantity ?? 0);
    if (!variantId) return { items: [], error: "Un producto de la canasta no es válido." };
    if (!Number.isFinite(quantity) || quantity <= 0) return { items: [], error: "Las cantidades deben ser mayores a cero." };
    items.push({ variantId, quantity: Math.round(quantity * 1000) / 1000 });
  }
  return { items, error: null };
}

/**
 * Direct sale. Prices and costs are re-read from the database — never trusted
 * from the browser — and stock leaves through inventory_movements, the same
 * ledger the ticket system uses.
 */
export async function createSaleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const { items, error: cartError } = parseCart(formData.get("cart"));
    if (cartError) return failure(cartError);

    const paymentMethod = String(formData.get("paymentMethod") ?? "CASH");
    if (!PAYMENT_METHODS.includes(paymentMethod)) return failure("Método de pago no válido.");

    const clientId = String(formData.get("clientId") ?? "").trim() || null;
    const discountCents = parseMoneyToCents(formData.get("discount")) ?? 0;
    if (discountCents < 0) return failure("El descuento no puede ser negativo.");

    const db = adminDb();
    const variantIds = items.map((item) => item.variantId);
    const { data: variants, error: variantError } = await db
      .from("product_variants")
      .select("id, name, sku, unit_label, price_cents, cost_cents, product_id, is_active, products(name, product_kind, is_active)")
      .in("id", variantIds);
    if (variantError) return failure(describeError(new Error(variantError.message), "No fue posible leer los productos."));
    if (!variants || variants.length !== variantIds.length) return failure("Algún producto de la canasta ya no existe.");

    const stock = await getStockFor(variantIds);
    const rows = variants as unknown as Array<{
      id: string;
      name: string;
      sku: string | null;
      unit_label: string | null;
      price_cents: number;
      cost_cents: number;
      product_id: string;
      is_active: boolean;
      products: { name: string; product_kind: string; is_active: boolean } | Array<{ name: string; product_kind: string; is_active: boolean }>;
    }>;
    const byId = new Map(rows.map((row) => [row.id, row]));

    let subtotalCents = 0;
    const saleItems: Array<Record<string, unknown>> = [];
    for (const item of items) {
      const variant = byId.get(item.variantId);
      if (!variant) return failure("Algún producto de la canasta ya no existe.");
      const product = Array.isArray(variant.products) ? variant.products[0] : variant.products;
      if (!variant.is_active || !product?.is_active) return failure(`"${product?.name ?? "Producto"}" ya no está activo.`);

      const available = stock.get(item.variantId) ?? 0;
      if (item.quantity > available) {
        return failure(
          `No hay existencia suficiente de "${product.name} · ${variant.name}": disponible ${available}, solicitado ${item.quantity}.`,
        );
      }
      if (product.product_kind !== "MEASURED" && !Number.isInteger(item.quantity)) {
        return failure(`"${product.name}" solo admite cantidades enteras.`);
      }

      const lineTotal = Math.round(variant.price_cents * item.quantity);
      subtotalCents += lineTotal;
      saleItems.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku,
        unit_label: variant.unit_label,
        quantity: item.quantity,
        unit_price_cents: variant.price_cents,
        unit_cost_cents: variant.cost_cents ?? 0,
        total_cents: lineTotal,
      });
    }

    if (discountCents > subtotalCents) return failure("El descuento no puede superar el total de la venta.");

    const session = await getOpenCashSession();
    const { data: sale, error: saleError } = await db
      .from("sales")
      .insert({
        business_id: DEFAULT_BUSINESS_ID,
        sale_type: "PRODUCT",
        status: "COMPLETED",
        client_id: clientId,
        cash_session_id: session?.id ?? null,
        concept: null,
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        total_cents: subtotalCents - discountCents,
        payment_method: paymentMethod,
        notes: String(formData.get("notes") ?? "").trim() || null,
        created_by_admin_id: actor.id,
      })
      .select("id, sale_number")
      .single();
    if (saleError) return failure(describeError(new Error(saleError.message), "No fue posible registrar la venta."));

    const saleId = sale.id as string;
    const { error: itemsError } = await db
      .from("sale_items")
      .insert(saleItems.map((item) => ({ ...item, sale_id: saleId })));
    if (itemsError) {
      await db.from("sales").delete().eq("id", saleId);
      return failure(describeError(new Error(itemsError.message), "No fue posible registrar los productos vendidos."));
    }

    const { error: movementError } = await db.from("inventory_movements").insert(
      items.map((item) => ({
        variant_id: item.variantId,
        movement_type: "ALLOCATION",
        quantity_delta: -item.quantity,
        sale_id: saleId,
        reason: `Venta directa ${sale.sale_number}`,
        created_by_admin_id: actor.id,
      })),
    );
    if (movementError) {
      await db.from("sale_items").delete().eq("sale_id", saleId);
      await db.from("sales").delete().eq("id", saleId);
      return failure(describeError(new Error(movementError.message), "No fue posible descontar el inventario."));
    }

    await logActivity({
      adminUserId: actor.id,
      action: "SALE_CREATED",
      entityType: "sales",
      entityId: saleId,
      newData: { sale_number: sale.sale_number, total_cents: subtotalCents - discountCents, items: saleItems.length },
    });
    revalidate();
    return ok(`Venta ${sale.sale_number} registrada.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar la venta."));
  }
}

/** Free sale: an amount with a concept. It feeds Balance but never inventory. */
export async function createFreeSaleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const concept = String(formData.get("concept") ?? "").trim();
    const amountCents = parseMoneyToCents(formData.get("amount"));
    const paymentMethod = String(formData.get("paymentMethod") ?? "CASH");
    const date = String(formData.get("date") ?? "").trim();

    if (!concept) return failure("Escribe el concepto de la venta.");
    if (amountCents === null || amountCents <= 0) return failure("El monto debe ser mayor a cero.");
    if (!PAYMENT_METHODS.includes(paymentMethod)) return failure("Método de pago no válido.");

    const session = await getOpenCashSession();
    const { data, error } = await adminDb()
      .from("sales")
      .insert({
        business_id: DEFAULT_BUSINESS_ID,
        sale_type: "FREE",
        status: "COMPLETED",
        client_id: String(formData.get("clientId") ?? "").trim() || null,
        cash_session_id: session?.id ?? null,
        concept,
        subtotal_cents: amountCents,
        discount_cents: 0,
        total_cents: amountCents,
        payment_method: paymentMethod,
        notes: String(formData.get("notes") ?? "").trim() || null,
        sold_at: date ? new Date(`${date}T12:00:00`).toISOString() : new Date().toISOString(),
        created_by_admin_id: actor.id,
      })
      .select("id, sale_number")
      .single();
    if (error) return failure(describeError(new Error(error.message), "No fue posible registrar la venta libre."));

    await logActivity({
      adminUserId: actor.id,
      action: "FREE_SALE_CREATED",
      entityType: "sales",
      entityId: data.id as string,
      newData: { concept, amountCents },
    });
    revalidate();
    return ok(`Venta libre ${data.sale_number} registrada.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar la venta libre."));
  }
}

export async function createExpenseAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const concept = String(formData.get("concept") ?? "").trim();
    const amountCents = parseMoneyToCents(formData.get("amount"));
    const paymentMethod = String(formData.get("paymentMethod") ?? "CASH");
    const date = String(formData.get("date") ?? "").trim();

    if (!concept) return failure("Escribe el concepto del gasto.");
    if (amountCents === null || amountCents <= 0) return failure("El monto debe ser mayor a cero.");
    if (!PAYMENT_METHODS.includes(paymentMethod)) return failure("Método de pago no válido.");

    let receiptKey: string | null = null;
    let receiptWarning = "";
    const receipt = formData.get("receipt");
    if (receipt instanceof File && receipt.size > 0) {
      const extension = RECEIPT_EXTENSIONS[receipt.type];
      if (!extension) return failure("El comprobante debe ser JPG, PNG, WEBP o PDF.");
      if (receipt.size > MAX_RECEIPT_BYTES) return failure("El comprobante debe pesar 10 MB o menos.");
      const key = `${DEFAULT_BUSINESS_ID}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await adminStorage()
        .from(EXPENSE_RECEIPT_BUCKET)
        .upload(key, receipt, { contentType: receipt.type, upsert: false });
      if (uploadError) {
        receiptWarning = ` El gasto se registró, pero el comprobante no se pudo guardar (${uploadError.message}).`;
      } else {
        receiptKey = key;
      }
    }

    const session = await getOpenCashSession();
    const { data, error } = await adminDb()
      .from("expenses")
      .insert({
        business_id: DEFAULT_BUSINESS_ID,
        concept,
        category: String(formData.get("category") ?? "").trim() || null,
        amount_cents: amountCents,
        supplier_id: String(formData.get("supplierId") ?? "").trim() || null,
        cash_session_id: session?.id ?? null,
        payment_method: paymentMethod,
        expense_date: date || new Date().toISOString().slice(0, 10),
        notes: String(formData.get("notes") ?? "").trim() || null,
        receipt_storage_key: receiptKey,
        created_by_admin_id: actor.id,
      })
      .select("id")
      .single();
    if (error) return failure(describeError(new Error(error.message), "No fue posible registrar el gasto."));

    await logActivity({
      adminUserId: actor.id,
      action: "EXPENSE_CREATED",
      entityType: "expenses",
      entityId: data.id as string,
      newData: { concept, amountCents },
    });
    revalidate();
    return ok(`Gasto registrado.${receiptWarning}`);
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar el gasto."));
  }
}

export async function openCashSessionAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const openingCents = parseMoneyToCents(formData.get("openingAmount")) ?? 0;
    if (openingCents < 0) return failure("El monto inicial no puede ser negativo.");

    const existing = await getOpenCashSession();
    if (existing) return failure("Ya hay una caja abierta. Ciérrala antes de abrir otra.");

    const { data, error } = await adminDb()
      .from("cash_sessions")
      .insert({
        business_id: DEFAULT_BUSINESS_ID,
        status: "OPEN",
        opening_amount_cents: openingCents,
        opened_by_admin_id: actor.id,
        notes: String(formData.get("notes") ?? "").trim() || null,
      })
      .select("id")
      .single();
    if (error) return failure(describeError(new Error(error.message), "No fue posible abrir la caja."));

    await logActivity({
      adminUserId: actor.id,
      action: "CASH_SESSION_OPENED",
      entityType: "cash_sessions",
      entityId: data.id as string,
      newData: { opening_amount_cents: openingCents },
    });
    revalidate();
    return ok("Caja abierta.");
  } catch (error) {
    return failure(describeError(error, "No fue posible abrir la caja."));
  }
}

export async function closeCashSessionAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const sessionId = String(formData.get("sessionId") ?? "");
    const closingCents = parseMoneyToCents(formData.get("closingAmount"));
    if (!sessionId) return failure("No hay una caja abierta.");
    if (closingCents === null || closingCents < 0) return failure("Escribe el efectivo contado al cerrar.");

    const db = adminDb();
    const { data: session, error: sessionError } = await db
      .from("cash_sessions")
      .select("id, opening_amount_cents, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) return failure(describeError(new Error(sessionError.message), "No fue posible leer la caja."));
    if (!session || session.status !== "OPEN") return failure("Esa caja ya no está abierta.");

    const expected = await computeExpectedCash(sessionId, Number(session.opening_amount_cents ?? 0));
    const { error } = await db
      .from("cash_sessions")
      .update({
        status: "CLOSED",
        closing_amount_cents: closingCents,
        expected_amount_cents: expected,
        closed_at: new Date().toISOString(),
        closed_by_admin_id: actor.id,
        notes: String(formData.get("notes") ?? "").trim() || null,
      })
      .eq("id", sessionId);
    if (error) return failure(describeError(new Error(error.message), "No fue posible cerrar la caja."));

    await logActivity({
      adminUserId: actor.id,
      action: "CASH_SESSION_CLOSED",
      entityType: "cash_sessions",
      entityId: sessionId,
      newData: { closing_amount_cents: closingCents, expected_amount_cents: expected },
    });
    revalidate();
    const difference = closingCents - expected;
    return ok(
      difference === 0
        ? "Caja cerrada sin diferencias."
        : `Caja cerrada con una diferencia de ${(difference / 100).toFixed(2)} MXN respecto a lo esperado.`,
    );
  } catch (error) {
    return failure(describeError(error, "No fue posible cerrar la caja."));
  }
}
