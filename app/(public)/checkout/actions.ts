"use server";

import { redirect } from "next/navigation";
import type { CartItem } from "../../../lib/cart/CartContext";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";
import { getAuthenticatedUser } from "../../../lib/supabase/auth";
import { resolveOrderItems } from "../../../lib/supabase/orders";
import { getTelegramLinkUrl } from "../../../lib/telegram/env";
import { sendTelegramMessage } from "../../../lib/telegram/send";

export type CreateOrderResult =
  | { success: true; orderId: string; itemsCount: number; totalCents: number; skippedCount: number; telegramLinkUrl: string | null }
  | { success: false; error: string };

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

export async function createOrderAction(items: CartItem[]): Promise<CreateOrderResult> {
  const { user } = await getAuthenticatedUser();
  if (!user) {
    // Never trust a client-supplied identity for who the order belongs to — the
    // action only proceeds using the server's own session lookup.
    redirect("/login?next=/checkout");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { success: false, error: "Tu carrito está vacío." };
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

  const { data: order, error: orderError } = await admin
    .schema("luxury_finds")
    .from("orders")
    .insert({ client_id: user.id, origin: "WEBSITE", status: "DRAFT" })
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
