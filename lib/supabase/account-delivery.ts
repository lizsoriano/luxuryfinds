import { localDay, type SchedulerSlot } from "../account-view";
import { adminDb } from "./business";
import { related } from "./sales";

// Delivery points and published schedule for the client's panel. Read with the
// service role because occupancy needs other clients' bookings — but the output
// is only "this 10-minute slot is free/taken": never who booked it.

export const CLIENT_BOOKING_MIGRATION = "database/migrations/019_client_delivery_booking.sql";

// Migration 020 ("Solicitudes por confirmar"): when applied, what she books is a
// REQUEST for ONE 10-minute window per visit that only the owner confirms.
// While it is missing, 019 keeps working exactly as before (confirmed at once,
// one consecutive 10-minute slot per product) and the owner's Agenda shows a
// notice naming the file. See lib/supabase/delivery-requests.ts.
export { DELIVERY_REQUESTS_MIGRATION, isDeliveryRequestsAvailable } from "./delivery-requests";

export type DeliveryDay = { date: string; slots: Array<SchedulerSlot & { pickup: boolean; didi: boolean }> };
export type DeliveryPoint = { id: string; name: string; address: string; mapUrl: string; days: DeliveryDay[]; pickup: boolean; didi: boolean };

export function mapUrl(name: string, address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}, La Paz, B.C.S.`)}`;
}

/** Whether migration 019 is applied: the probe function answers. Never throws. */
export async function isClientBookingAvailable() {
  try {
    const { error } = await adminDb().rpc("client_delivery_booking_version");
    return !error;
  } catch {
    return false;
  }
}

async function noticeDays() {
  const { data } = await adminDb().from("app_settings").select("value").eq("key", "delivery_minimum_notice_days").maybeSingle();
  const value = Number(data?.value);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function addDays(day: string, days: number) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Active delivery points with their bookable slots from the first allowed day
 * (today + delivery_minimum_notice_days, business-local) for `horizonDays`.
 * Business time is fixed UTC-7 (Mazatlán has no DST), like lib/supabase/admin-agenda.ts.
 */
export async function getDeliveryPoints(horizonDays = 28): Promise<{ points: DeliveryPoint[]; noticeDays: number }> {
  const db = adminDb();
  const [{ data: locations, error }, notice] = await Promise.all([
    db.from("delivery_locations").select("id, name, address").eq("is_active", true).order("name"),
    noticeDays(),
  ]);
  if (error) throw new Error(error.message);
  if (!locations?.length) return { points: [], noticeDays: notice };

  const firstDay = addDays(localDay(new Date()), notice);
  const from = `${firstDay}T00:00:00-07:00`;
  const to = `${addDays(firstDay, horizonDays)}T00:00:00-07:00`;
  const slots: Array<{ id: string; availability_id: string; starts_at: string; delivery_availabilities: { location_id: string; enabled_pickup: boolean; enabled_didi: boolean } | null }> = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data, error: slotsError } = await db
      .from("delivery_slots")
      .select("id, availability_id, starts_at, delivery_availabilities!inner(location_id, enabled_pickup, enabled_didi)")
      .eq("is_enabled", true)
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at")
      .order("id")
      .range(offset, offset + 999);
    if (slotsError) throw new Error(slotsError.message);
    slots.push(...((data ?? []) as unknown as typeof slots));
    if ((data?.length ?? 0) < 1000) break;
  }
  const taken = new Set(
    (await related<{ id: string; slot_id: string; status: string }>("delivery_bookings", "id,slot_id,status", "slot_id", slots.map((s) => s.id)))
      .filter((b) => b.status === "BOOKED")
      .map((b) => b.slot_id),
  );

  const points: DeliveryPoint[] = locations.map((location) => {
    const own = slots.filter((slot) => slot.delivery_availabilities?.location_id === location.id);
    const days = new Map<string, DeliveryDay>();
    for (const slot of own) {
      const date = localDay(slot.starts_at);
      const day = days.get(date) ?? { date, slots: [] };
      day.slots.push({ id: slot.id, availabilityId: slot.availability_id, startsAt: slot.starts_at, free: !taken.has(slot.id), pickup: Boolean(slot.delivery_availabilities?.enabled_pickup), didi: Boolean(slot.delivery_availabilities?.enabled_didi) });
      days.set(date, day);
    }
    const dayList = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    return {
      id: location.id as string,
      name: location.name as string,
      address: location.address as string,
      mapUrl: mapUrl(location.name as string, location.address as string),
      days: dayList,
      pickup: own.some((slot) => slot.delivery_availabilities?.enabled_pickup),
      didi: own.some((slot) => slot.delivery_availabilities?.enabled_didi),
    };
  });
  return { points, noticeDays: notice };
}

/**
 * The points the owner publishes in her policies (app/(public)/como-comprar,
 * §6). Shown only while no delivery_locations exist, so the client is never
 * left with an empty screen. Keep in sync with that page.
 */
export const POLICY_DELIVERY_POINTS = [
  { name: "Villas del Encanto", hours: "De 4:00 p. m. a 8:00 p. m." },
  { name: "Indeco", hours: "De 8:30 a. m. a 12:00 p. m." },
  { name: "Tec de La Paz", hours: "Aproximadamente de 1:00 p. m. a 9:00 p. m. (puede variar según el día)" },
  { name: "Zona Centro, cerca de la Normal Urbana", hours: "Únicamente a las 9:00 a. m. o a las 5:00 p. m." },
];
