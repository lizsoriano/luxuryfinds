"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { businessToday, LOGISTICS_STATUS_LABELS } from "../../../lib/format";
import { getStockFor, getWeeklyPlanEligibility } from "../../../lib/supabase/admin-catalog";
import { getRequestedPaymentPlan } from "../../../lib/supabase/admin-orders";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";
import { sendTelegramMessage } from "../../../lib/telegram/send";

function revalidate(orderId?: string) {
  revalidatePath("/admin/pedidos");
  if (orderId) revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/por-ordenar");
  revalidatePath("/admin/en-camino");
  revalidatePath("/admin/agenda");
}

/** notification_type only has entries for some logistics_status values; GENERAL covers the rest. */
const LOGISTICS_NOTIFICATION_TYPE: Record<string, string> = {
  READY_TO_ORDER: "READY_TO_ORDER",
  ORDERED: "ORDERED",
  IN_TRANSIT: "IN_TRANSIT",
  RECEIVED_LA_PAZ: "RECEIVED_LA_PAZ",
  READY_FOR_DELIVERY: "READY_FOR_DELIVERY",
};

const TERMINAL_LOGISTICS_STATUSES = new Set(["DELIVERED", "CANCELLED_INCIDENT"]);

/**
 * Shared by Por ordenar and En camino (both just show tickets filtered to a
 * different slice of this same status list). Optionally records where the
 * item is being ordered from / a purchase reference in order_items.notes —
 * there is no dedicated column for that, and notes is otherwise unused here.
 */
export async function advanceLogisticsStatusAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const ticketId = String(formData.get("ticketId") ?? "");
    const newStatus = String(formData.get("status") ?? "");
    if (!ticketId) return failure("Ticket no encontrado.");
    if (!(newStatus in LOGISTICS_STATUS_LABELS)) return failure("Estado logístico no válido.");

    const db = adminDb();
    const { data: ticket, error: ticketError } = await db
      .from("tickets")
      .select("id, order_item_id, client_id, ticket_number, product_name_snapshot, logistics_status")
      .eq("id", ticketId)
      .maybeSingle();
    if (ticketError) return failure(describeError(new Error(ticketError.message), "No fue posible leer el ticket."));
    if (!ticket) return failure("Ticket no encontrado.");
    if (TERMINAL_LOGISTICS_STATUSES.has(ticket.logistics_status)) {
      return failure("Este ticket ya está en un estado final y no se puede mover.");
    }

    const { error: updateError } = await db
      .from("tickets")
      .update({ logistics_status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", ticketId);
    if (updateError) return failure(describeError(new Error(updateError.message), "No fue posible actualizar el ticket."));

    const note = String(formData.get("note") ?? "").trim();
    if (note) {
      await db.from("order_items").update({ notes: note }).eq("id", ticket.order_item_id);
    }

    const statusLabel = LOGISTICS_STATUS_LABELS[newStatus] ?? newStatus;
    try {
      await db.from("notifications").insert({
        client_id: ticket.client_id,
        ticket_id: ticket.id,
        type: LOGISTICS_NOTIFICATION_TYPE[newStatus] ?? "GENERAL",
        title: statusLabel,
        body: `Tu pedido "${ticket.product_name_snapshot}" (ticket ${ticket.ticket_number}) ahora está: ${statusLabel}.`,
      });
    } catch {
      // Best-effort, matches every other in-app notification write in this app.
    }
    try {
      const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", ticket.client_id).maybeSingle();
      if (client?.telegram_chat_id) {
        await sendTelegramMessage(
          client.telegram_chat_id,
          `📦 <b>${statusLabel}</b>\nTicket: ${ticket.ticket_number}\n${ticket.product_name_snapshot}${note ? `\n${note}` : ""}`,
        );
      }
    } catch {
      // Best-effort.
    }

    await logActivity({
      adminUserId: actor.id,
      action: "TICKET_LOGISTICS_UPDATED",
      entityType: "tickets",
      entityId: ticketId,
      previousData: { logistics_status: ticket.logistics_status },
      newData: { logistics_status: newStatus, note: note || null },
    });
    revalidate();
    return ok(`Ticket ${ticket.ticket_number} actualizado a "${statusLabel}".`);
  } catch (error) {
    return failure(describeError(error, "No fue posible actualizar el ticket."));
  }
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Adds `days` to a "YYYY-MM-DD" calendar date, in UTC to avoid DST drift. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** End of business day (America/Mazatlan, fixed UTC-7 since Mexico dropped DST). */
function businessEndOfDay(dateStr: string): string {
  return `${dateStr}T23:59:59-07:00`;
}

/** Splits a total into `count` whole-cent installments that sum back exactly. */
function splitEvenly(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const amounts = new Array(count).fill(base);
  amounts[count - 1] += remainder;
  return amounts;
}

/**
 * Best-effort cleanup after a partial failure while generating tickets for a
 * pedido. Deletes child rows before parents to respect the ON DELETE RESTRICT
 * foreign keys in schema.sql (installments -> payment_plans -> tickets, and
 * inventory_movements -> tickets).
 */
async function rollbackTickets(db: ReturnType<typeof adminDb>, ticketIds: string[]) {
  if (!ticketIds.length) return;
  const { data: plans } = await db.from("payment_plans").select("id").in("ticket_id", ticketIds);
  const planIds = (plans ?? []).map((plan) => plan.id as string);
  if (planIds.length) {
    await db.from("installments").delete().in("payment_plan_id", planIds);
    await db.from("payment_plans").delete().in("id", planIds);
  }
  await db.from("inventory_movements").delete().in("ticket_id", ticketIds);
  await db.from("tickets").delete().in("id", ticketIds);
}

type ConfirmItemRow = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit_price_cents: number;
  products:
    | { name: string; catalog_type: string; is_active: boolean; brands: { name: string } | { name: string }[] | null; categories: { name: string } | { name: string }[] | null }
    | Array<{ name: string; catalog_type: string; is_active: boolean; brands: { name: string } | { name: string }[] | null; categories: { name: string } | { name: string }[] | null }>
    | null;
  product_variants:
    | { name: string; attributes: Record<string, unknown>; is_active: boolean }
    | Array<{ name: string; attributes: Record<string, unknown>; is_active: boolean }>
    | null;
};

/**
 * A pedido from the public site (app/(public)/checkout/actions.ts) carries a
 * single requested payment mode for the whole order (see orders.requested_payment_mode,
 * database/migrations/004_weekly_plan_checkout.sql). Confirming it generates a
 * ticket per artículo in that same mode: FULL (the default, and the only mode
 * possible before that migration runs) or WEEKLY_PLAN, which also generates a
 * payment_plan + its weekly installments per ticket. LAYAWAY has no checkout
 * UI and is never produced here.
 */
export async function confirmOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const orderId = String(formData.get("id") ?? "");
    if (!orderId) return failure("Pedido no encontrado.");

    const db = adminDb();
    const { data: order, error: orderError } = await db
      .from("orders")
      .select("id, status, client_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) return failure(describeError(new Error(orderError.message), "No fue posible leer el pedido."));
    if (!order) return failure("Pedido no encontrado.");
    if (order.status !== "DRAFT") return failure("Solo se pueden confirmar pedidos en borrador.");

    const requestedPlan = await getRequestedPaymentPlan(orderId);

    const { data: items, error: itemsError } = await db
      .from("order_items")
      .select(
        "id, product_id, variant_id, quantity, unit_price_cents, products(name, catalog_type, is_active, brands(name), categories(name)), product_variants(name, attributes, is_active)",
      )
      .eq("order_id", orderId);
    if (itemsError) return failure(describeError(new Error(itemsError.message), "No fue posible leer los artículos del pedido."));
    if (!items || !items.length) return failure("El pedido no tiene artículos.");

    const rows = items as unknown as ConfirmItemRow[];

    const needed = new Map<string, number>();
    for (const row of rows) {
      const product = relation(row.products);
      const variant = relation(row.product_variants);
      if (!row.product_id || !product) {
        return failure("Uno de los artículos del pedido ya no tiene un producto asociado. Cancela el pedido en su lugar.");
      }
      if (!row.variant_id || !variant) {
        return failure(`"${product.name}" ya no tiene la variante que se pidió. Cancela el pedido en su lugar.`);
      }
      if (!product.is_active || !variant.is_active) {
        return failure(`"${product.name}" ya no está activo y no se puede confirmar. Cancela el pedido en su lugar.`);
      }
      needed.set(row.variant_id, (needed.get(row.variant_id) ?? 0) + row.quantity);
    }

    const stock = await getStockFor([...needed.keys()]);
    for (const [variantId, quantity] of needed) {
      const available = stock.get(variantId) ?? 0;
      if (available < quantity) {
        const row = rows.find((item) => item.variant_id === variantId);
        const product = row ? relation(row.products) : null;
        return failure(
          `No hay existencia suficiente de "${product?.name ?? "un producto"}": disponible ${available}, solicitado ${quantity}.`,
        );
      }
    }

    const productIds = [...new Set(rows.map((row) => row.product_id as string))];

    if (requestedPlan.mode === "WEEKLY_PLAN") {
      // requestedPlan.mode can only be WEEKLY_PLAN once migration 004 has run
      // (getRequestedPaymentPlan degrades to FULL otherwise), so
      // products.weekly_plan_eligible is guaranteed to exist here.
      const { data: eligibility, error: eligibilityError } = await db
        .from("products")
        .select("id, weekly_plan_eligible")
        .in("id", productIds);
      if (eligibilityError) {
        return failure(describeError(new Error(eligibilityError.message), "No fue posible validar el plan semanal del pedido."));
      }
      const eligibleIds = new Set((eligibility ?? []).filter((row) => row.weekly_plan_eligible).map((row) => row.id as string));
      const ineligible = rows.find((row) => !eligibleIds.has(row.product_id as string));
      if (ineligible) {
        const product = relation(ineligible.products);
        return failure(
          `"${product?.name ?? "Un producto"}" ya no admite plan semanal. Contacta a la clienta o cancela el pedido.`,
        );
      }
      if (!requestedPlan.numberOfWeeks || requestedPlan.numberOfWeeks < 4 || requestedPlan.numberOfWeeks > 16) {
        return failure("El pedido no tiene un número de semanas válido para el plan.");
      }
    }

    const { data: images } = await db
      .from("product_images")
      .select("product_id, storage_key, sort_order")
      .in("product_id", productIds)
      .order("sort_order", { ascending: true });
    const imageByProduct = new Map<string, string>();
    for (const image of images ?? []) {
      if (!imageByProduct.has(image.product_id as string)) {
        imageByProduct.set(image.product_id as string, image.storage_key as string);
      }
    }

    const ticketMode = requestedPlan.mode === "WEEKLY_PLAN" ? ("WEEKLY_PLAN" as const) : ("FULL" as const);
    const createdTicketIds: string[] = [];
    const ticketResults: Array<{ ticketId: string; agreedTotalCents: number }> = [];
    const movementRows: Array<{ variant_id: string; movement_type: "ALLOCATION"; quantity_delta: number; ticket_id: string; reason: string; created_by_admin_id: string }> = [];

    for (const row of rows) {
      const product = relation(row.products)!;
      const variant = relation(row.product_variants)!;
      const brand = relation(product.brands);
      const category = relation(product.categories);
      const agreedTotalCents = row.unit_price_cents * row.quantity;

      const { data: ticket, error: ticketError } = await db
        .from("tickets")
        .insert({
          order_item_id: row.id,
          client_id: order.client_id,
          product_id: row.product_id,
          variant_id: row.variant_id,
          product_name_snapshot: product.name,
          brand_name_snapshot: brand?.name ?? null,
          category_name_snapshot: category?.name ?? null,
          variant_name_snapshot: variant.name,
          variant_attributes_snapshot: variant.attributes ?? {},
          image_storage_key_snapshot: imageByProduct.get(row.product_id as string) ?? null,
          quantity: row.quantity,
          cash_unit_price_cents: row.unit_price_cents,
          agreed_total_cents: agreedTotalCents,
          discount_cents: 0,
          payment_mode: ticketMode,
          catalog_type_snapshot: product.catalog_type,
          logistics_status: product.catalog_type === "IMMEDIATE" ? "READY_FOR_DELIVERY" : "WAITING_TO_ORDER",
        })
        .select("id")
        .single();

      if (ticketError || !ticket) {
        await rollbackTickets(db, createdTicketIds);
        return failure(describeError(new Error(ticketError?.message ?? "error desconocido"), "No fue posible generar los tickets del pedido."));
      }

      createdTicketIds.push(ticket.id as string);
      ticketResults.push({ ticketId: ticket.id as string, agreedTotalCents });
      movementRows.push({
        variant_id: row.variant_id as string,
        movement_type: "ALLOCATION",
        quantity_delta: -row.quantity,
        ticket_id: ticket.id as string,
        reason: `Pedido confirmado ${orderId.slice(0, 8).toUpperCase()}`,
        created_by_admin_id: actor.id,
      });
    }

    const { error: movementError } = await db.from("inventory_movements").insert(movementRows);
    if (movementError) {
      await rollbackTickets(db, createdTicketIds);
      return failure(describeError(new Error(movementError.message), "No fue posible descontar el inventario del pedido."));
    }

    if (ticketMode === "WEEKLY_PLAN") {
      const weeks = requestedPlan.numberOfWeeks as number;
      const startDate = businessToday();
      const paymentWeekday = new Date(`${startDate}T12:00:00`).getDay();

      const { data: plans, error: planError } = await db
        .from("payment_plans")
        .insert(
          ticketResults.map((t) => ({
            ticket_id: t.ticketId,
            mode: "WEEKLY_PLAN" as const,
            status: "ACTIVE" as const,
            agreed_total_cents: t.agreedTotalCents,
            initial_payment_cents: 0,
            number_of_weeks: weeks,
            start_date: startDate,
            payment_weekday: paymentWeekday,
            order_trigger_installment: weeks - 1,
            created_by_admin_id: actor.id,
          })),
        )
        .select("id, ticket_id, agreed_total_cents");
      if (planError || !plans) {
        await rollbackTickets(db, createdTicketIds);
        return failure(describeError(new Error(planError?.message ?? "error desconocido"), "No fue posible generar el plan de pagos del pedido."));
      }

      const installmentRows = plans.flatMap((plan) =>
        splitEvenly(Number(plan.agreed_total_cents), weeks).map((amountCents, index) => ({
          payment_plan_id: plan.id,
          installment_number: index + 1,
          due_at: businessEndOfDay(addDays(startDate, 7 * (index + 1))),
          amount_cents: amountCents,
          status: "PENDING" as const,
        })),
      );

      const { error: installmentError } = await db.from("installments").insert(installmentRows);
      if (installmentError) {
        await rollbackTickets(db, createdTicketIds);
        return failure(describeError(new Error(installmentError.message), "No fue posible generar las cuotas del plan de pagos."));
      }
    }

    const { error: confirmError } = await db
      .from("orders")
      .update({ status: "CONFIRMED", confirmed_at: new Date().toISOString() })
      .eq("id", orderId);
    if (confirmError) {
      return failure(
        `Los tickets se generaron y el inventario se descontó, pero no fue posible marcar el pedido como confirmado (${confirmError.message}). Intenta de nuevo o revisa el pedido.`,
      );
    }

    await logActivity({
      adminUserId: actor.id,
      action: "ORDER_CONFIRMED",
      entityType: "orders",
      entityId: orderId,
      newData: { ticketsCreated: createdTicketIds.length, paymentMode: ticketMode },
    });
    revalidate(orderId);
    return ok(
      ticketMode === "WEEKLY_PLAN"
        ? `Pedido confirmado. Se generaron ${createdTicketIds.length} ticket(s) en plan semanal a ${requestedPlan.numberOfWeeks} semanas.`
        : `Pedido confirmado. Se generaron ${createdTicketIds.length} ticket(s).`,
    );
  } catch (error) {
    return failure(describeError(error, "No fue posible confirmar el pedido."));
  }
}

export async function cancelOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const orderId = String(formData.get("id") ?? "");
    if (!orderId) return failure("Pedido no encontrado.");

    const db = adminDb();
    const { data: order, error: orderError } = await db.from("orders").select("id, status").eq("id", orderId).maybeSingle();
    if (orderError) return failure(describeError(new Error(orderError.message), "No fue posible leer el pedido."));
    if (!order) return failure("Pedido no encontrado.");
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      return failure("Este pedido ya no se puede cancelar.");
    }

    if (order.status === "CONFIRMED") {
      const { data: orderItems, error: orderItemsError } = await db.from("order_items").select("id").eq("order_id", orderId);
      if (orderItemsError) return failure(describeError(new Error(orderItemsError.message), "No fue posible leer los artículos del pedido."));
      const orderItemIds = (orderItems ?? []).map((row) => row.id as string);

      if (orderItemIds.length) {
        const { data: tickets, error: ticketsError } = await db
          .from("tickets")
          .select("id, variant_id, quantity, logistics_status")
          .in("order_item_id", orderItemIds);
        if (ticketsError) return failure(describeError(new Error(ticketsError.message), "No fue posible leer los tickets del pedido."));

        const ticketRows = tickets ?? [];
        if (ticketRows.some((ticket) => ticket.logistics_status === "DELIVERED")) {
          return failure("Este pedido ya tiene artículos entregados; no se puede cancelar desde aquí.");
        }

        const activeTickets = ticketRows.filter((ticket) => ticket.logistics_status !== "CANCELLED_INCIDENT");
        if (activeTickets.length) {
          const { error: releaseError } = await db.from("inventory_movements").insert(
            activeTickets.map((ticket) => ({
              variant_id: ticket.variant_id as string,
              movement_type: "RELEASE" as const,
              quantity_delta: Number(ticket.quantity),
              ticket_id: ticket.id as string,
              reason: `Pedido cancelado ${orderId.slice(0, 8).toUpperCase()}`,
              created_by_admin_id: actor.id,
            })),
          );
          if (releaseError) return failure(describeError(new Error(releaseError.message), "No fue posible liberar el inventario del pedido."));

          const { error: ticketUpdateError } = await db
            .from("tickets")
            .update({ financial_status: "CANCELLED_INCIDENT", logistics_status: "CANCELLED_INCIDENT" })
            .in(
              "id",
              activeTickets.map((ticket) => ticket.id as string),
            );
          if (ticketUpdateError) return failure(describeError(new Error(ticketUpdateError.message), "No fue posible actualizar los tickets del pedido."));

          // Only WEEKLY_PLAN tickets have a payment_plan row; this matches zero
          // rows (and is a harmless no-op) for FULL-mode tickets.
          const { error: planCancelError } = await db
            .from("payment_plans")
            .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
            .in(
              "ticket_id",
              activeTickets.map((ticket) => ticket.id as string),
            )
            .eq("status", "ACTIVE");
          if (planCancelError) return failure(describeError(new Error(planCancelError.message), "No fue posible cancelar el plan de pagos del pedido."));
        }
      }
    }

    const { error: cancelError } = await db
      .from("orders")
      .update({ status: "CANCELLED", cancelled_at: new Date().toISOString() })
      .eq("id", orderId);
    if (cancelError) return failure(describeError(new Error(cancelError.message), "No fue posible cancelar el pedido."));

    await logActivity({ adminUserId: actor.id, action: "ORDER_CANCELLED", entityType: "orders", entityId: orderId });
    revalidate(orderId);
    return ok("Pedido cancelado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible cancelar el pedido."));
  }
}

export type CreateManualOrderResult = { success: true; orderId: string } | { success: false; error: string };

type ManualCartLine = { variantId: string; quantity: number };

/**
 * The panel's counterpart to app/(public)/checkout/actions.ts. A pedido made
 * over WhatsApp/phone lands here instead of the customer's own cart, with
 * origin ADMIN_MANUAL instead of WEBSITE — everything downstream (confirming,
 * ticket/payment_plan generation, cancelling) is identical either way.
 */
export async function createManualOrderAction(
  clientId: string,
  cart: ManualCartLine[],
  paymentMode: "FULL" | "WEEKLY_PLAN",
  numberOfWeeks?: number,
): Promise<CreateManualOrderResult> {
  try {
    const actor = await requireAdminActor();
    if (!clientId) return { success: false, error: "Elige una clienta." };
    if (!cart.length) return { success: false, error: "Agrega al menos un artículo." };
    for (const line of cart) {
      if (!line.variantId || !Number.isInteger(line.quantity) || line.quantity <= 0) {
        return { success: false, error: "Un artículo del pedido no es válido." };
      }
    }

    const db = adminDb();

    const { data: client, error: clientError } = await db.from("clients").select("id, status").eq("id", clientId).maybeSingle();
    if (clientError) return { success: false, error: describeError(new Error(clientError.message), "No fue posible leer la clienta.") };
    if (!client) return { success: false, error: "Clienta no encontrada." };
    if (client.status !== "ACTIVE") return { success: false, error: "Esta clienta no está activa." };

    const variantIds = cart.map((line) => line.variantId);
    const { data: variants, error: variantsError } = await db
      .from("product_variants")
      .select("id, price_cents, is_active, product_id, products(is_active)")
      .in("id", variantIds);
    if (variantsError) return { success: false, error: describeError(new Error(variantsError.message), "No fue posible leer los productos.") };
    if (!variants || variants.length !== new Set(variantIds).size) return { success: false, error: "Algún artículo ya no existe." };

    type VariantRow = { id: string; price_cents: number; is_active: boolean; product_id: string; products: { is_active: boolean } | { is_active: boolean }[] | null };
    const rows = variants as unknown as VariantRow[];
    for (const row of rows) {
      const product = relation(row.products);
      if (!row.is_active || !product?.is_active) return { success: false, error: "Uno de los artículos ya no está activo." };
    }

    let requestedPaymentMode: "FULL" | "WEEKLY_PLAN" = "FULL";
    let requestedNumberOfWeeks: number | null = null;
    if (paymentMode === "WEEKLY_PLAN") {
      if (!Number.isInteger(numberOfWeeks) || (numberOfWeeks as number) < 4 || (numberOfWeeks as number) > 16) {
        return { success: false, error: "Elige un número de semanas válido (4 a 16)." };
      }
      const productIds = [...new Set(rows.map((row) => row.product_id))];
      const eligibility = await getWeeklyPlanEligibility(productIds);
      if (productIds.some((id) => !eligibility.get(id))) {
        return { success: false, error: "Uno o más productos no admiten plan semanal." };
      }
      requestedPaymentMode = "WEEKLY_PLAN";
      requestedNumberOfWeeks = numberOfWeeks as number;
    }

    const byId = new Map(rows.map((row) => [row.id, row]));

    // requested_payment_mode/requested_number_of_weeks only exist once migration
    // 004 has run; only referencing them for an actual WEEKLY_PLAN request keeps
    // a plain FULL pedido working either way (see app/(public)/checkout/actions.ts
    // for the identical reasoning).
    const orderInsert: Record<string, unknown> = {
      client_id: clientId,
      origin: "ADMIN_MANUAL",
      status: "DRAFT",
      created_by_admin_id: actor.id,
    };
    if (requestedPaymentMode === "WEEKLY_PLAN") {
      orderInsert.requested_payment_mode = requestedPaymentMode;
      orderInsert.requested_number_of_weeks = requestedNumberOfWeeks;
    }

    const { data: order, error: orderError } = await db.from("orders").insert(orderInsert).select("id").single();
    if (orderError || !order) {
      return { success: false, error: describeError(new Error(orderError?.message ?? "error desconocido"), "No fue posible crear el pedido.") };
    }

    const { error: itemsError } = await db.from("order_items").insert(
      cart.map((line) => {
        const variant = byId.get(line.variantId)!;
        return {
          order_id: order.id,
          product_id: variant.product_id,
          variant_id: line.variantId,
          quantity: line.quantity,
          unit_price_cents: variant.price_cents,
        };
      }),
    );
    if (itemsError) {
      await db.from("orders").delete().eq("id", order.id);
      return { success: false, error: describeError(new Error(itemsError.message), "No fue posible registrar los artículos del pedido.") };
    }

    await logActivity({
      adminUserId: actor.id,
      action: "ORDER_CREATED_MANUAL",
      entityType: "orders",
      entityId: order.id as string,
      newData: { clientId, items: cart.length, paymentMode: requestedPaymentMode },
    });
    revalidate(order.id as string);
    return { success: true, orderId: order.id as string };
  } catch (error) {
    return { success: false, error: describeError(error, "No fue posible crear el pedido.") };
  }
}
