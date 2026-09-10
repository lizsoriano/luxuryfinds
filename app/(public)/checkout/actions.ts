"use server";

import { redirect } from "next/navigation";
import type { CartItem } from "../../../lib/cart/CartContext";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";
import { getAuthenticatedUser } from "../../../lib/supabase/auth";
import { checkWeeklyPlanEligibility, resolveOrderItems } from "../../../lib/supabase/orders";
import { getTelegramLinkUrl } from "../../../lib/telegram/env";
import { sendTelegramMessage } from "../../../lib/telegram/send";

export type CreateOrderResult =
  | { success: true; orderId: string; itemsCount: number; totalCents: number; skippedCount: number; telegramLinkUrl: string | null }
  | { success: false; error: string };

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

/** Cart-level check the checkout UI calls to decide whether to offer WEEKLY_PLAN at all. */
export async function getWeeklyPlanOptionAction(items: CartItem[]): Promise<{ eligible: boolean }> {
  if (!Array.isArray(items) || items.length === 0) return { eligible: false };
  return { eligible: await checkWeeklyPlanEligibility(items) };
}

export async function createOrderAction(
  items: CartItem[],
  paymentMode: "FULL" | "WEEKLY_PLAN" = "FULL",
  numberOfWeeks?: number,
): Promise<CreateOrderResult> {
  const { user } = await getAuthenticatedUser();
  if (!user) {
    // Never trust a client-supplied identity for who the order belongs to — the
    // action only proceeds using the server's own session lookup.
    redirect("/login?next=/checkout");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { success: false, error: "Tu carrito está vacío." };
  }

  // The requested mode/term is re-validated here regardless of what the
  // checkout UI showed — the client cannot be trusted to have re-checked
  // eligibility since the page loaded.
  let requestedPaymentMode: "FULL" | "WEEKLY_PLAN" = "FULL";
  let requestedNumberOfWeeks: number | null = null;
  if (paymentMode === "WEEKLY_PLAN") {
    if (!Number.isInteger(numberOfWeeks) || (numberOfWeeks as number) < 4 || (numberOfWeeks as number) > 16) {
      return { success: false, error: "Elige un número de semanas válido (4 a 16)." };
    }
    const eligible = await checkWeeklyPlanEligibility(items);
    if (!eligible) {
      return {
        success: false,
        error: "Uno o más productos de tu carrito ya no admiten plan semanal. Recarga la página e intenta de nuevo.",
      };
    }
    requestedPaymentMode = "WEEKLY_PLAN";
    requestedNumberOfWeeks = numberOfWeeks as number;
  }

  let resolved, skipped;
  try {
    ({ resolved, skipped } = await resolveOrderItems(items));
  } catch {
    return { success: false, error: "No fue posible validar los productos de tu carrito. Intenta de nuevo." };
  }

  if (resolved.length === 0) {
    return { success: false, error: "Los productos de tu carrito ya no están disponibles." };
  }

  const admin = createAdminSupabaseClient();

  // requested_payment_mode/requested_number_of_weeks only exist once
  // database/migrations/004_weekly_plan_checkout.sql has been applied. They are
  // only ever set here when WEEKLY_PLAN was actually requested, which itself
  // requires that migration (checkWeeklyPlanEligibility above returns false
  // otherwise) — so a FULL checkout never references these columns and keeps
  // working unmodified before the migration runs.
  const orderInsert: Record<string, unknown> = { client_id: user.id, origin: "WEBSITE", status: "DRAFT" };
  if (requestedPaymentMode === "WEEKLY_PLAN") {
    orderInsert.requested_payment_mode = requestedPaymentMode;
    orderInsert.requested_number_of_weeks = requestedNumberOfWeeks;
  }

  const { data: order, error: orderError } = await admin
    .schema("luxury_finds")
    .from("orders")
    .insert(orderInsert)
    .select("id")
    .single();

  if (orderError || !order) {
    return { success: false, error: "No fue posible registrar tu pedido. Intenta de nuevo." };
  }

  const { error: itemsError } = await admin
    .schema("luxury_finds")
    .from("order_items")
    .insert(
      resolved.map((item) => ({
        order_id: order.id,
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
      })),
    );

  if (itemsError) {
    await admin.schema("luxury_finds").from("orders").delete().eq("id", order.id);
    return { success: false, error: "No fue posible registrar los artículos de tu pedido. Intenta de nuevo." };
  }

  const totalCents = resolved.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const itemsCount = resolved.reduce((sum, item) => sum + item.quantity, 0);

  // Telegram confirmation is best-effort: a failure here must never undo the order
  // we already created and must never surface as an error to the shopper.
  let telegramLinkUrl: string | null = null;
  try {
    const { data: client } = await admin
      .schema("luxury_finds")
      .from("clients")
      .select("telegram_chat_id")
      .eq("id", user.id)
      .maybeSingle();

    if (client?.telegram_chat_id) {
      const folio = order.id.slice(0, 8).toUpperCase();
      await sendTelegramMessage(
        client.telegram_chat_id,
        `✅ <b>Pedido confirmado</b>\nFolio: ${folio}\nArtículos: ${itemsCount}\nTotal: ${money(totalCents)}\n\nNos pondremos en contacto contigo para continuar con el pago.`,
      );
    } else {
      telegramLinkUrl = getTelegramLinkUrl(user.id);
    }
  } catch (error) {
    console.error("[checkout] No fue posible enviar la confirmación por Telegram", error);
  }

  return {
    success: true,
    orderId: order.id,
    itemsCount,
    totalCents,
    skippedCount: skipped.length,
    telegramLinkUrl,
  };
}
