"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { parseMoneyToCents } from "../../../lib/format";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";
import { sendTelegramMessage } from "../../../lib/telegram/send";

function revalidate() {
  revalidatePath("/admin/devoluciones");
  revalidatePath("/admin/pedidos");
}

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

async function notifyClient(db: ReturnType<typeof adminDb>, clientId: string, type: string, title: string, body: string, telegramText: string) {
  try {
    await db.from("notifications").insert({ client_id: clientId, type, title, body });
  } catch {
    // Best-effort.
  }
  try {
    const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", clientId).maybeSingle();
    if (client?.telegram_chat_id) await sendTelegramMessage(client.telegram_chat_id, telegramText);
  } catch {
    // Best-effort.
  }
}

export async function markRefundInProcessAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    if (!id) return failure("Solicitud no encontrada.");

    const db = adminDb();
    const { data: request, error: requestError } = await db.from("refund_requests").select("id, status").eq("id", id).maybeSingle();
    if (requestError) return failure(describeError(new Error(requestError.message), "No fue posible leer la solicitud."));
    if (!request) return failure("Solicitud no encontrada.");
    if (request.status !== "REQUESTED") return failure("Esta solicitud ya no está en espera.");

    const { error } = await db.from("refund_requests").update({ status: "IN_PROCESS", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible actualizar la solicitud."));

    await logActivity({ adminUserId: actor.id, action: "REFUND_REQUEST_IN_PROCESS", entityType: "refund_requests", entityId: id });
    revalidate();
    return ok("Solicitud marcada en proceso.");
  } catch (error) {
    return failure(describeError(error, "No fue posible actualizar la solicitud."));
  }
}

export async function completeRefundAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    if (!id) return failure("Solicitud no encontrada.");

    const amountCents = parseMoneyToCents(formData.get("amount"));
    if (amountCents === null || amountCents <= 0) return failure("El monto reembolsado debe ser mayor a cero.");
    const method = String(formData.get("method") ?? "").trim();
    if (!method) return failure("Indica el método con el que se hizo el reembolso.");
    const reference = String(formData.get("reference") ?? "").trim();
    if (!reference) return failure("Indica la referencia o folio de la transferencia.");

    const db = adminDb();
    const { data: request, error: requestError } = await db
      .from("refund_requests")
      .select("id, status, ticket_id, client_id, reason")
      .eq("id", id)
      .maybeSingle();
    if (requestError) return failure(describeError(new Error(requestError.message), "No fue posible leer la solicitud."));
    if (!request) return failure("Solicitud no encontrada.");
    if (request.status === "COMPLETED" || request.status === "REJECTED") return failure("Esta solicitud ya se cerró.");

    const { data: ticket, error: ticketError } = await db.from("tickets").select("id, ticket_number").eq("id", request.ticket_id).maybeSingle();
    if (ticketError) return failure(describeError(new Error(ticketError.message), "No fue posible leer el ticket."));

    const { error: refundError } = await db.from("refunds").insert({
      refund_request_id: id,
      amount_cents: amountCents,
      refunded_at: new Date().toISOString(),
      method,
      reference,
      reason: request.reason,
      processed_by_admin_id: actor.id,
    });
    if (refundError) return failure(describeError(new Error(refundError.message), "No fue posible registrar el reembolso."));

    const { error: requestUpdateError } = await db
      .from("refund_requests")
      .update({ status: "COMPLETED", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (requestUpdateError) {
      return failure(
        `El reembolso se registró, pero no fue posible cerrar la solicitud (${requestUpdateError.message}). Revísala manualmente.`,
      );
    }

    if (ticket) {
      await db.from("tickets").update({ financial_status: "REFUNDED", updated_at: new Date().toISOString() }).eq("id", ticket.id);
    }

    await notifyClient(
      db,
      request.client_id as string,
      "REFUND_PROCESSED",
      "Reembolso procesado",
      `Se procesó tu reembolso de ${money(amountCents)}${ticket ? ` del ticket ${ticket.ticket_number}` : ""}.`,
      `💸 <b>Reembolso procesado</b>\nMonto: ${money(amountCents)}\nReferencia: ${reference}`,
    );

    await logActivity({
      adminUserId: actor.id,
      action: "REFUND_COMPLETED",
      entityType: "refund_requests",
      entityId: id,
      newData: { amountCents, method, reference },
    });
    revalidate();
    return ok(`Reembolso de ${money(amountCents)} registrado.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible completar el reembolso."));
  }
}

export async function rejectRefundAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    if (!id) return failure("Solicitud no encontrada.");
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return failure("Escribe el motivo del rechazo.");

    const db = adminDb();
    const { data: request, error: requestError } = await db
      .from("refund_requests")
      .select("id, status, client_id, ticket_id")
      .eq("id", id)
      .maybeSingle();
    if (requestError) return failure(describeError(new Error(requestError.message), "No fue posible leer la solicitud."));
    if (!request) return failure("Solicitud no encontrada.");
    if (request.status === "COMPLETED" || request.status === "REJECTED") return failure("Esta solicitud ya se cerró.");

    const { error } = await db.from("refund_requests").update({ status: "REJECTED", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible rechazar la solicitud."));

    const { data: ticket } = await db.from("tickets").select("ticket_number").eq("id", request.ticket_id).maybeSingle();
    await notifyClient(
      db,
      request.client_id as string,
      "GENERAL",
      "Solicitud de reembolso rechazada",
      `Tu solicitud de reembolso${ticket ? ` del ticket ${ticket.ticket_number}` : ""} fue rechazada. Motivo: ${note}`,
      `⚠️ <b>Solicitud de reembolso rechazada</b>\nMotivo: ${note}`,
    );

    await logActivity({ adminUserId: actor.id, action: "REFUND_REJECTED", entityType: "refund_requests", entityId: id, newData: { note } });
    revalidate();
    return ok("Solicitud rechazada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible rechazar la solicitud."));
  }
}
