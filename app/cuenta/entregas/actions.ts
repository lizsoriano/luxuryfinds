"use server";

import { revalidatePath } from "next/cache";
import { formatDayLong, formatTimeOnly } from "../../../lib/account-view";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { CLIENT_BOOKING_MIGRATION, isClientBookingAvailable } from "../../../lib/supabase/account-delivery";
import { getClientProfile } from "../../../lib/supabase/auth";
import { adminDb } from "../../../lib/supabase/business";
import { getBookingRequestStates, isDeliveryRequestsAvailable } from "../../../lib/supabase/delivery-requests";
import { sendTelegramMessage } from "../../../lib/telegram/send";

// Client self-service delivery booking. The session is verified first
// (getClientProfile -> auth.getUser) and ONLY that verified id reaches the SQL
// functions of migration 019, which re-check ownership, READY_FOR_DELIVERY,
// slot availability and the notice/cancel rules inside one locked transaction.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function friendly(error: { message?: string; code?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  if (message.startsWith("LF: ")) return message.slice(4);
  if (error?.code === "23505" || message.includes("uq_delivery_slot_active")) return "Ese horario se acaba de ocupar. Elige otro.";
  if (message.includes("uq_delivery_ticket_active")) return "Ese producto ya tiene una cita activa. Actualiza la página.";
  if (error?.code === "PGRST202" || /Could not find the function|does not exist/.test(message)) return `El agendado en línea aún no está activo (falta aplicar ${CLIENT_BOOKING_MIGRATION}). Escríbenos para agendar.`;
  return fallback;
}

function revalidateAll() {
  revalidatePath("/cuenta");
  revalidatePath("/cuenta/entregas");
  revalidatePath("/cuenta/compras");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin", "layout"); // "Agenda" badge with the requests waiting for the owner
  revalidatePath("/empleado/entregas");
}

async function notify(clientId: string, type: "DELIVERY_BOOKED" | "DELIVERY_CANCELLED", title: string, body: string, telegram: string, ticketId: string | null) {
  const db = adminDb();
  try {
    await db.from("notifications").insert({ client_id: clientId, ticket_id: ticketId, type, title, body });
  } catch {
    // Best-effort, like every other in-app notice.
  }
  try {
    const { data } = await db.from("clients").select("telegram_chat_id").eq("id", clientId).maybeSingle();
    if (data?.telegram_chat_id) await sendTelegramMessage(data.telegram_chat_id as string, telegram);
  } catch {
    // Best-effort.
  }
}

async function telegramOnly(clientId: string, text: string) {
  try {
    const { data } = await adminDb().from("clients").select("telegram_chat_id").eq("id", clientId).maybeSingle();
    if (data?.telegram_chat_id) await sendTelegramMessage(data.telegram_chat_id as string, text);
  } catch {
    // Best-effort.
  }
}

export async function bookDeliveryAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { user, profile } = await getClientProfile();
  if (!profile || profile.status !== "ACTIVE") return failure("Tu cuenta no está activa. Escríbenos para ayudarte.");
  const ticketIds = [...new Set(formData.getAll("ticketId").map(String))];
  const slotId = String(formData.get("slotId") ?? "");
  const deliveryType = String(formData.get("deliveryType") ?? "");
  const reschedule = formData.get("reschedule") === "1";
  if (!ticketIds.length || ticketIds.some((id) => !UUID.test(id))) return failure("Elige al menos un producto para entregar.");
  if (!UUID.test(slotId)) return failure("Elige un día y un horario.");
  if (!["PICKUP", "DIDI"].includes(deliveryType)) return failure("Elige si recoges o si lo enviamos por DiDi.");
  if (!(await isClientBookingAvailable())) return failure(`El agendado en línea aún no está activo (falta aplicar ${CLIENT_BOOKING_MIGRATION}). Escríbenos para agendar.`);
  // With 020 the SQL function leaves a REQUEST (one 10-minute window) and writes
  // the in-app notice itself; without it, 019 confirms right away.
  const requests = await isDeliveryRequestsAvailable();

  const db = adminDb();
  const { data, error } = await db.rpc("client_book_delivery", {
    p_client_id: user.id,
    p_ticket_ids: ticketIds,
    p_slot_id: slotId,
    p_delivery_type: deliveryType,
    p_reschedule: reschedule,
  });
  if (error) return failure(friendly(error, "No pudimos agendar tu entrega. Intenta de nuevo."));
  const booked = (data ?? []) as Array<{ r_booking_id: string; r_ticket_id: string; r_slot_id: string; r_starts_at: string }>;
  if (!booked.length) return failure("No pudimos agendar tu entrega. Intenta de nuevo.");

  const startsAt = booked.map((row) => row.r_starts_at).sort()[0];
  const [{ data: tickets }, { data: slot }] = await Promise.all([
    db.from("tickets").select("id, ticket_number, product_name_snapshot").eq("client_id", user.id).in("id", booked.map((row) => row.r_ticket_id)),
    db.from("delivery_slots").select("delivery_availabilities(delivery_locations(name, address))").eq("id", booked[0].r_slot_id).maybeSingle(),
  ]);
  const location = (slot as unknown as { delivery_availabilities: { delivery_locations: { name: string; address: string } | null } | null } | null)?.delivery_availabilities?.delivery_locations ?? null;
  const when = `${formatDayLong(startsAt)}, ${formatTimeOnly(startsAt)}`;
  const place = location ? `${location.name} (${location.address})` : "el punto de entrega";
  const mode = deliveryType === "DIDI" ? "Envío por DiDi" : "Recoger";
  const list = (tickets ?? []).map((t) => `${t.ticket_number} · ${t.product_name_snapshot}`);
  if (requests) {
    await telegramOnly(
      user.id,
      `🕒 <b>${reschedule ? "Nuevo horario solicitado" : "Solicitud recibida"}: espera la confirmación</b>\n${escapeHtml(when)} (10 minutos)\n${escapeHtml(place)} · ${mode}\n${list.map(escapeHtml).join("\n")}\nAún no es una cita confirmada: te avisamos cuando puedas pasar.`,
    );
    revalidateAll();
    return ok(`Apartamos tu horario del ${when} en ${location?.name ?? "el punto elegido"} (10 minutos para ${booked.length === 1 ? "tu producto" : `tus ${booked.length} productos`}).`);
  }
  await notify(
    user.id,
    "DELIVERY_BOOKED",
    reschedule ? "Entrega reagendada" : "Entrega agendada",
    `Tu entrega quedó para el ${when} en ${place} (${mode}). ${list.join("; ")}`,
    `📅 <b>${reschedule ? "Entrega reagendada" : "Entrega agendada"}</b>\n${escapeHtml(when)}\n${escapeHtml(place)} · ${mode}\n${list.map(escapeHtml).join("\n")}`,
    booked.length === 1 ? booked[0].r_ticket_id : null,
  );
  revalidateAll();
  return ok(`¡Listo! Tu entrega quedó para el ${when} en ${location?.name ?? "el punto elegido"}.`);
}

export async function cancelDeliveryAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { user, profile } = await getClientProfile();
  if (!profile) return failure("Tu perfil aún no está listo.");
  const bookingIds = [...new Set(formData.getAll("bookingId").map(String))];
  if (!bookingIds.length || bookingIds.some((id) => !UUID.test(id))) return failure("Cita no encontrada.");
  if (!(await isClientBookingAvailable())) return failure(`Para cancelar escríbenos (falta aplicar ${CLIENT_BOOKING_MIGRATION}).`);

  const db = adminDb();
  const { data, error } = await db.rpc("client_cancel_delivery", { p_client_id: user.id, p_booking_ids: bookingIds });
  if (error) return failure(friendly(error, "No pudimos cancelar tu cita. Intenta de nuevo."));
  const cancelled = (data ?? []) as Array<{ r_booking_id: string; r_ticket_id: string }>;
  const [{ data: tickets }, states] = await Promise.all([
    db.from("tickets").select("ticket_number").eq("client_id", user.id).in("id", cancelled.map((row) => row.r_ticket_id)),
    // Ids returned by the function: already verified as hers.
    getBookingRequestStates(cancelled.map((row) => row.r_booking_id)).catch(() => null),
  ]);
  const wasRequest = Boolean(states && cancelled.some((row) => states.get(row.r_booking_id)?.confirmedAt === null));
  const numbers = (tickets ?? []).map((t) => t.ticket_number as string).join(", ");
  const what = wasRequest ? "solicitud de entrega" : "cita de entrega";
  await notify(
    user.id,
    "DELIVERY_CANCELLED",
    wasRequest ? "Solicitud cancelada" : "Cita cancelada",
    `Cancelaste tu ${what}${numbers ? ` (${numbers})` : ""}. Tu pedido sigue listo: agenda otra cuando gustes.`,
    `⚠️ <b>${wasRequest ? "Solicitud cancelada" : "Cita cancelada"} por la clienta</b>\n${escapeHtml(numbers)}`,
    cancelled.length === 1 ? cancelled[0].r_ticket_id : null,
  );
  revalidateAll();
  return ok(wasRequest ? "Cancelamos tu solicitud y liberamos el horario. Tu pedido sigue listo: elige otro cuando gustes." : "Cancelamos tu cita. Tu pedido sigue listo: agenda otra cuando gustes.");
}
