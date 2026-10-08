import { adminDb } from "./business";
import { getBookingRequestStates } from "./delivery-requests";

// ---------------------------------------------------------------------------
// Agenda = delivery_locations/delivery_availabilities/delivery_slots/
// delivery_bookings, all part of database/schema.sql (no migration needed).
// Availabilities are the admin-published windows ("Tuesdays 10am-2pm at the
// showroom"); slots are the 10-minute increments schema.sql requires
// (CHECK ends_at = starts_at + interval '10 minutes') generated from them.
// The owner books a ticket into a slot on a client's behalf (born confirmed);
// clients send requests from /cuenta/entregas. With migration 020 one visit =
// one slot (one or more tickets) and a client's visit stays "Por confirmar"
// until the owner confirms it (lib/supabase/delivery-requests.ts).
// ---------------------------------------------------------------------------

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type LocationRow = { id: string; name: string; address: string };

export async function listLocations(): Promise<LocationRow[]> {
  const { data, error } = await adminDb().from("delivery_locations").select("id, name, address").eq("is_active", true).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as LocationRow[];
}

export type SlotBooking = {
  bookingId: string;
  status: string;
  deliveryType: string;
  ticketNumber: string;
  productName: string;
  clientName: string;
  visitId: string;
  /** BOOKED but not confirmed yet (migration 020): a client's request. */
  pending: boolean;
};

export type SlotRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  is_enabled: boolean;
  /** First booking of the slot. */
  booking: SlotBooking | null;
  /** Every booking of the slot: one visit, one or more tickets. */
  bookings: SlotBooking[];
};

/** `day` is a business-local (America/Mazatlan, fixed UTC-7) YYYY-MM-DD calendar date. */
export async function listSlotsForDay(locationId: string, day: string): Promise<SlotRow[]> {
  const from = `${day}T00:00:00-07:00`;
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  const to = `${next.toISOString().slice(0, 10)}T00:00:00-07:00`;

  const db = adminDb();
  const { data: slots, error } = await db
    .from("delivery_slots")
    .select("id, starts_at, ends_at, is_enabled, availability_id, delivery_availabilities!inner(location_id)")
    .eq("delivery_availabilities.location_id", locationId)
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);

  const slotIds = (slots ?? []).map((slot) => slot.id as string);
  const bookingsBySlot = new Map<string, SlotBooking[]>();
  if (slotIds.length) {
    const { data: bookings, error: bookingsError } = await db
      .from("delivery_bookings")
      .select("id, slot_id, status, delivery_type, tickets(ticket_number, product_name_snapshot), clients(first_name, last_name)")
      .in("slot_id", slotIds)
      .in("status", ["BOOKED", "COMPLETED"]);
    if (bookingsError) throw new Error(bookingsError.message);
    const states = await getBookingRequestStates((bookings ?? []).map((row) => row.id as string));
    for (const row of bookings ?? []) {
      const ticket = relation(row.tickets as unknown as { ticket_number: string; product_name_snapshot: string }[]);
      const client = relation(row.clients as unknown as { first_name: string; last_name: string }[]);
      const state = states?.get(row.id as string);
      const list = bookingsBySlot.get(row.slot_id as string) ?? [];
      bookingsBySlot.set(row.slot_id as string, list);
      list.push({
        bookingId: row.id as string,
        status: row.status as string,
        deliveryType: row.delivery_type as string,
        ticketNumber: ticket?.ticket_number ?? "—",
        productName: ticket?.product_name_snapshot ?? "Producto eliminado",
        clientName: client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada",
        visitId: state?.visitId ?? (row.id as string),
        pending: row.status === "BOOKED" && Boolean(state) && state?.confirmedAt === null,
      });
    }
  }

  return (slots ?? []).map((slot) => ({
    id: slot.id as string,
    starts_at: slot.starts_at as string,
    ends_at: slot.ends_at as string,
    is_enabled: slot.is_enabled as boolean,
    booking: bookingsBySlot.get(slot.id as string)?.[0] ?? null,
    bookings: bookingsBySlot.get(slot.id as string) ?? [],
  }));
}
