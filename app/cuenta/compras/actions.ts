"use server";

import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { getClientProfile } from "../../../lib/supabase/auth";
import { adminDb } from "../../../lib/supabase/business";
import { sendTelegramMessage } from "../../../lib/telegram/send";

// A client cancels HER OWN order while the owner has not confirmed it yet
// (orders.status = 'DRAFT'). At that point nothing was charged, no ticket
// exists and no stock was set aside (all of that happens in the owner's
// confirmOrderAction), so cancelling is one guarded UPDATE. The session is
// verified first and only that verified id is used to scope the write; the
// order id from the form never decides whose order it is. Once the owner
// confirms, cancelling goes through her (tickets, inventory and payment rules).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALREADY_CONFIRMED = "Tu pedido ya fue confirmado, así que no se puede cancelar desde aquí. Escríbenos y lo revisamos contigo.";

export async function cancelOwnOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await getClientProfile();
  const orderId = String(formData.get("orderId") ?? "");
  if (!UUID.test(orderId)) return failure("Pedido no encontrado.");

  const db = adminDb();
  try {
    // A confirmation that is running right now has already created tickets while
    // the order still reads DRAFT: treat it as confirmed instead of racing it.
    const { data: items, error: itemsError } = await db.from("order_items").select("id, orders!inner(client_id)").eq("order_id", orderId).eq("orders.client_id", user.id);
    if (itemsError) return failure("No fue posible cancelar tu pedido. Intenta de nuevo.");
    const itemIds = (items ?? []).map((item) => item.id as string);
    if (itemIds.length) {
      const { data: tickets, error: ticketsError } = await db.from("tickets").select("id").in("order_item_id", itemIds).limit(1);
      if (ticketsError) return failure("No fue posible cancelar tu pedido. Intenta de nuevo.");
      if (tickets?.length) return failure(ALREADY_CONFIRMED);
    }

    const now = new Date().toISOString();
    const { data: cancelled, error } = await db
      .from("orders")
      .update({ status: "CANCELLED", cancelled_at: now, updated_at: now })
      .eq("id", orderId)
      .eq("client_id", user.id)
      .eq("status", "DRAFT")
      .select("id");
    if (error) return failure("No fue posible cancelar tu pedido. Intenta de nuevo.");

    if (!cancelled?.length) {
      const { data: current } = await db.from("orders").select("status").eq("id", orderId).eq("client_id", user.id).maybeSingle();
      if (!current) return failure("Pedido no encontrado.");
      if (current.status === "CANCELLED") return ok("Este pedido ya estaba cancelado.");
      return failure(ALREADY_CONFIRMED);
    }
  } catch {
    return failure("No fue posible cancelar tu pedido. Intenta de nuevo.");
  }

  const folio = orderId.slice(0, 8).toUpperCase();
  // Everything below is best-effort: the order is already cancelled.
  try {
    await db.from("activity_logs").insert({ client_id: user.id, action: "ORDER_CANCELLED_BY_CLIENT", entity_type: "orders", entity_id: orderId, previous_data: { status: "DRAFT" }, new_data: { status: "CANCELLED" } });
  } catch {
    // Best-effort.
  }
  try {
    await db.from("notifications").insert({ client_id: user.id, type: "GENERAL", title: "Cancelaste tu pedido", body: `Tu pedido ${folio} quedó cancelado. No se realizó ningún cobro.` });
  } catch {
    // Best-effort.
  }
  try {
    const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", user.id).maybeSingle();
    if (client?.telegram_chat_id) await sendTelegramMessage(client.telegram_chat_id as string, `❌ <b>Pedido cancelado</b>\nFolio: ${folio}\n\nCancelaste tu pedido. No se realizó ningún cobro.`);
  } catch {
    // Best-effort.
  }

  revalidatePath("/cuenta");
  revalidatePath("/cuenta/compras");
  revalidatePath(`/cuenta/compras/p-${orderId}`);
  revalidatePath("/admin/pedidos");
  revalidatePath(`/admin/pedidos/${orderId}`);
  return ok("Tu pedido quedó cancelado. No se realizó ningún cobro.");
}
