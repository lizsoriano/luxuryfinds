import { LOGISTICS_STATUS_LABELS } from "../format";
import { sendTelegramMessage } from "../telegram/send";
import { adminDb } from "./business";

// The client-facing notice when a ticket changes logistics status: the SAME
// title, body and Telegram text that "Actualizar estado" sends from Por ordenar
// / En camino (app/admin/pedidos/actions.ts#advanceLogisticsStatusAction), so a
// ticket moved by a shipment reads exactly like one moved by hand. That action
// is left untouched; this is a copy of its message format for flows that move
// several tickets at once (shipments). Best-effort: never throws.

/** notification_type only has entries for some logistics_status values; GENERAL covers the rest. */
const LOGISTICS_NOTIFICATION_TYPE: Record<string, string> = {
  READY_TO_ORDER: "READY_TO_ORDER",
  ORDERED: "ORDERED",
  IN_TRANSIT: "IN_TRANSIT",
  RECEIVED_LA_PAZ: "RECEIVED_LA_PAZ",
  READY_FOR_DELIVERY: "READY_FOR_DELIVERY",
};

export type TicketLogisticsNotice = {
  ticketId: string;
  clientId: string;
  ticketNumber: string;
  productName: string;
  status: string;
};

export async function notifyTicketLogistics(notice: TicketLogisticsNotice): Promise<void> {
  const db = adminDb();
  const statusLabel = LOGISTICS_STATUS_LABELS[notice.status] ?? notice.status;
  try {
    await db.from("notifications").insert({
      client_id: notice.clientId,
      ticket_id: notice.ticketId,
      type: LOGISTICS_NOTIFICATION_TYPE[notice.status] ?? "GENERAL",
      title: statusLabel,
      body: `Tu pedido "${notice.productName}" (ticket ${notice.ticketNumber}) ahora está: ${statusLabel}.`,
    });
  } catch {
    // Best-effort, matches every other in-app notification write in this app.
  }
  try {
    const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", notice.clientId).maybeSingle();
    if (client?.telegram_chat_id) {
      await sendTelegramMessage(
        client.telegram_chat_id as string,
        `📦 <b>${statusLabel}</b>\nTicket: ${notice.ticketNumber}\n${notice.productName}`,
      );
    }
  } catch {
    // Best-effort.
  }
}

export async function notifyTicketsLogistics(notices: TicketLogisticsNotice[]): Promise<void> {
  for (const notice of notices) await notifyTicketLogistics(notice);
}
