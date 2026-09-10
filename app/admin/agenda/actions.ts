"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";
import { sendTelegramMessage } from "../../../lib/telegram/send";

function revalidate() {
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/en-camino");
}

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

export async function createLocationAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const name = String(formData.get("name") ?? "").trim();
    const address = String(formData.get("address") ?? "").trim();
    if (!name) return failure("El nombre de la ubicación es obligatorio.");
    if (!address) return failure("La dirección es obligatoria.");

    const db = adminDb();
    const { error } = await db.from("delivery_locations").insert({ name, address, is_active: true });
    if (error) return failure(describeError(new Error(error.message), "No fue posible crear la ubicación."));

    await logActivity({ adminUserId: actor.id, action: "DELIVERY_LOCATION_CREATED", entityType: "delivery_locations", entityId: name, newData: { name, address } });
    revalidate();
    return ok(`Ubicación "${name}" creada.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible crear la ubicación."));
  }
}

/**
 * Publishing an availability window also generates its delivery_slots — the
 * 10-minute increments schema.sql requires (CHECK ends_at = starts_at +
 * interval '10 minutes'). There is no trigger for this, so it happens here.
 */
export async function createAvailabilityAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const locationId = String(formData.get("locationId") ?? "");
    const date = String(formData.get("date") ?? "");
    const startTime = String(formData.get("startTime") ?? "");
    const endTime = String(formData.get("endTime") ?? "");
    const enabledPickup = formData.get("enabledPickup") === "on";
    const enabledDidi = formData.get("enabledDidi") === "on";

    if (!locationId) return failure("Elige una ubicación.");
    if (!date || !startTime || !endTime) return failure("Completa la fecha y el horario.");
    if (!enabledPickup && !enabledDidi) return failure("Habilita al menos una modalidad (recoger o DiDi).");

    const startsAt = new Date(`${date}T${startTime}:00-07:00`);
    const endsAt = new Date(`${date}T${endTime}:00-07:00`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return failure("Fecha u hora no válida.");
    if (endsAt <= startsAt) return failure("La hora final debe ser después de la inicial.");

    const totalMinutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
    const slotCount = Math.floor(totalMinutes / 10);
    if (slotCount < 1) return failure("La ventana debe durar al menos 10 minutos.");

    const db = adminDb();
    const { data: availability, error: availabilityError } = await db
      .from("delivery_availabilities")
      .insert({
        location_id: locationId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + slotCount * 10 * 60000).toISOString(),
        enabled_pickup: enabledPickup,
        enabled_didi: enabledDidi,
        created_by_admin_id: actor.id,
      })
      .select("id")
      .single();
    if (availabilityError || !availability) {
      return failure(describeError(new Error(availabilityError?.message ?? "error desconocido"), "No fue posible publicar la disponibilidad."));
    }

    const slots = Array.from({ length: slotCount }, (_, index) => {
      const slotStart = new Date(startsAt.getTime() + index * 10 * 60000);
      const slotEnd = new Date(slotStart.getTime() + 10 * 60000);
      return { availability_id: availability.id, starts_at: slotStart.toISOString(), ends_at: slotEnd.toISOString(), is_enabled: true };
    });

    const { error: slotsError } = await db.from("delivery_slots").insert(slots);
    if (slotsError) {
      await db.from("delivery_availabilities").delete().eq("id", availability.id);
      return failure(describeError(new Error(slotsError.message), "No fue posible generar los horarios."));
    }

    await logActivity({
      adminUserId: actor.id,
      action: "DELIVERY_AVAILABILITY_PUBLISHED",
      entityType: "delivery_availabilities",
      entityId: availability.id as string,
      newData: { locationId, date, startTime, endTime, slotCount },
    });
    revalidate();
    return ok(`Disponibilidad publicada: ${slotCount} horario(s) de 10 minutos.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible publicar la disponibilidad."));
  }
}

export async function bookSlotAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const slotId = String(formData.get("slotId") ?? "");
    const ticketId = String(formData.get("ticketId") ?? "");
    const deliveryType = String(formData.get("deliveryType") ?? "");
    if (!slotId) return failure("Horario no encontrado.");
    if (!ticketId) return failure("Elige un ticket.");
    if (!["PICKUP", "DIDI"].includes(deliveryType)) return failure("Elige cómo se entrega.");

    const db = adminDb();
    const { data: slot, error: slotError } = await db.from("delivery_slots").select("id, is_enabled").eq("id", slotId).maybeSingle();
    if (slotError) return failure(describeError(new Error(slotError.message), "No fue posible leer el horario."));
    if (!slot || !slot.is_enabled) return failure("Ese horario ya no está disponible.");

    const { data: ticket, error: ticketError } = await db
      .from("tickets")
      .select("id, client_id, ticket_number, product_name_snapshot, logistics_status")
      .eq("id", ticketId)
      .maybeSingle();
    if (ticketError) return failure(describeError(new Error(ticketError.message), "No fue posible leer el ticket."));
    if (!ticket) return failure("Ticket no encontrado.");
    if (ticket.logistics_status !== "READY_FOR_DELIVERY") return failure("Este ticket ya no está listo para agendar entrega.");

    const { error: bookingError } = await db.from("delivery_bookings").insert({
      slot_id: slotId,
      ticket_id: ticketId,
      client_id: ticket.client_id,
      delivery_type: deliveryType,
      status: "BOOKED",
    });
    if (bookingError) return failure(describeError(new Error(bookingError.message), "No fue posible reservar el horario."));

    await db.from("tickets").update({ logistics_status: "DELIVERY_SCHEDULED", updated_at: new Date().toISOString() }).eq("id", ticketId);

    await notifyClient(
      db,
      ticket.client_id as string,
      "DELIVERY_BOOKED",
      "Entrega agendada",
      `Tu entrega para el ticket ${ticket.ticket_number} quedó agendada.`,
      `📅 <b>Entrega agendada</b>\nTicket: ${ticket.ticket_number}\n${ticket.product_name_snapshot}`,
    );

    await logActivity({
      adminUserId: actor.id,
      action: "DELIVERY_BOOKED",
      entityType: "delivery_bookings",
      entityId: slotId,
      newData: { ticketId, deliveryType },
    });
    revalidate();
    return ok(`Entrega agendada para el ticket ${ticket.ticket_number}.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible reservar el horario."));
  }
}

export async function completeBookingAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const bookingId = String(formData.get("bookingId") ?? "");
    if (!bookingId) return failure("Reserva no encontrada.");

    const db = adminDb();
    const { data: booking, error: bookingError } = await db
      .from("delivery_bookings")
      .select("id, ticket_id, status")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingError) return failure(describeError(new Error(bookingError.message), "No fue posible leer la reserva."));
    if (!booking) return failure("Reserva no encontrada.");
    if (booking.status !== "BOOKED") return failure("Esta reserva ya no está activa.");

    const { data: ticket } = await db.from("tickets").select("id, variant_id, quantity, ticket_number, client_id").eq("id", booking.ticket_id).maybeSingle();

    const { error } = await db.from("delivery_bookings").update({ status: "COMPLETED", completed_at: new Date().toISOString() }).eq("id", bookingId);
    if (error) return failure(describeError(new Error(error.message), "No fue posible completar la entrega."));

    if (ticket) {
      await db.from("tickets").update({ logistics_status: "DELIVERED", updated_at: new Date().toISOString() }).eq("id", ticket.id);
      // Audit-only movement: zero delta, the stock already left on ALLOCATION when the pedido was confirmed.
      await db.from("inventory_movements").insert({
        variant_id: ticket.variant_id,
        movement_type: "DELIVERY",
        quantity_delta: 0,
        ticket_id: ticket.id,
        reason: `Entrega completada ${ticket.ticket_number}`,
        created_by_admin_id: actor.id,
      });
      await notifyClient(
        db,
        ticket.client_id as string,
        "GENERAL",
        "Entrega completada",
        `Tu ticket ${ticket.ticket_number} fue entregado. ¡Gracias por tu compra!`,
        `✅ <b>Entrega completada</b>\nTicket: ${ticket.ticket_number}`,
      );
    }

    await logActivity({ adminUserId: actor.id, action: "DELIVERY_COMPLETED", entityType: "delivery_bookings", entityId: bookingId });
    revalidate();
    return ok("Entrega marcada como completada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible completar la entrega."));
  }
}

export async function cancelBookingAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const bookingId = String(formData.get("bookingId") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!bookingId) return failure("Reserva no encontrada.");
    if (!reason) return failure("Escribe el motivo de la cancelación.");

    const db = adminDb();
    const { data: booking, error: bookingError } = await db
      .from("delivery_bookings")
      .select("id, ticket_id, status")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingError) return failure(describeError(new Error(bookingError.message), "No fue posible leer la reserva."));
    if (!booking) return failure("Reserva no encontrada.");
    if (booking.status !== "BOOKED") return failure("Esta reserva ya no está activa.");

    const { error } = await db
      .from("delivery_bookings")
      .update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: reason })
      .eq("id", bookingId);
    if (error) return failure(describeError(new Error(error.message), "No fue posible cancelar la reserva."));

    const { data: ticket } = await db.from("tickets").select("id, ticket_number, client_id").eq("id", booking.ticket_id).maybeSingle();
    if (ticket) {
      await db.from("tickets").update({ logistics_status: "READY_FOR_DELIVERY", updated_at: new Date().toISOString() }).eq("id", ticket.id);
      await notifyClient(
        db,
        ticket.client_id as string,
        "DELIVERY_CANCELLED",
        "Entrega cancelada",
        `Tu entrega para el ticket ${ticket.ticket_number} fue cancelada. Motivo: ${reason}`,
        `⚠️ <b>Entrega cancelada</b>\nTicket: ${ticket.ticket_number}\nMotivo: ${reason}`,
      );
    }

    await logActivity({ adminUserId: actor.id, action: "DELIVERY_CANCELLED", entityType: "delivery_bookings", entityId: bookingId, newData: { reason } });
    revalidate();
    return ok("Reserva cancelada. El ticket vuelve a estar listo para agendar.");
  } catch (error) {
    return failure(describeError(error, "No fue posible cancelar la reserva."));
  }
}
