import { sendTelegramMessage } from "../telegram/send";
import { productImageUrl } from "./admin-catalog";
import { adminDb } from "./business";
import { STAFF_SELECTS } from "./staff-schema";

// ---------------------------------------------------------------------------
// "Solicitudes por confirmar" (migration 020). A client request is a
// delivery_bookings row with status BOOKED and confirmed_at NULL; every row of
// one visit (one 10-minute slot) shares visit_id. Only the owner confirms or
// rejects, through the SQL functions confirm_delivery_request /
// reject_delivery_request (atomic, service_role only).
//
// Graceful degradation: until 020 is applied every reader here answers "no
// information" (null / empty) and the rest of the app behaves exactly as with
// 019 — every BOOKED row is a confirmed appointment.
// ---------------------------------------------------------------------------

export const DELIVERY_REQUESTS_MIGRATION = "database/migrations/020_delivery_requests.sql";

/** Missing columns/functions of 020, as PostgREST reports them. */
export function isMissingDeliveryRequestsSchema(message: string | null | undefined) {
  if (!message) return false;
  const named = ["confirmed_at", "visit_id", "rejected_at", "confirm_delivery_request", "reject_delivery_request", "delivery_request_version"].some((name) => message.includes(name));
  return named && /does not exist|schema cache|Could not find/.test(message);
}

/** Whether 020 is applied (its probe function answers). Never throws. */
export async function isDeliveryRequestsAvailable() {
  try {
    const { error } = await adminDb().rpc("delivery_request_version");
    return !error;
  } catch {
    return false;
  }
}

export type BookingRequestState = { visitId: string; confirmedAt: string | null; rejectedAt: string | null };

/**
 * Request state of the given bookings (ids that the caller already scoped).
 * null = migration 020 not applied: treat every BOOKED row as confirmed.
 * (No ids: an empty map, whatever the schema.)
 */
export async function getBookingRequestStates(bookingIds: string[]): Promise<Map<string, BookingRequestState> | null> {
  const map = new Map<string, BookingRequestState>();
  const unique = [...new Set(bookingIds)];
  if (!unique.length) return map;
  for (let start = 0; start < unique.length; start += 150) {
    const { data, error } = await adminDb().from("delivery_bookings").select(STAFF_SELECTS.bookingRequests).in("id", unique.slice(start, start + 150));
    if (error) {
      if (isMissingDeliveryRequestsSchema(error.message)) return null;
      throw new Error(error.message);
    }
    for (const row of (data ?? []) as Array<{ id: string; visit_id: string; confirmed_at: string | null; rejected_at: string | null }>) {
      map.set(row.id, { visitId: row.visit_id, confirmedAt: row.confirmed_at, rejectedAt: row.rejected_at });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Owner: the queue.
// ---------------------------------------------------------------------------

export type PendingRequestItem = { bookingId: string; ticketId: string; ticketNumber: string; productName: string; variantName: string | null; imageUrl: string | null; balanceCents: number };
export type PendingRequest = {
  visitId: string;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  startsAt: string;
  endsAt: string;
  locationName: string;
  locationAddress: string;
  deliveryType: string;
  requestedAt: string;
  /** The slot already started: it can only be rejected. */
  expired: boolean;
  items: PendingRequestItem[];
  balanceCents: number;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Pending requests, oldest slot first. `available` is false until 020 is applied. */
export async function listPendingRequests(): Promise<{ available: boolean; requests: PendingRequest[] }> {
  const db = adminDb();
  const { data, error } = await db
    .from("delivery_bookings")
    .select("id, visit_id, ticket_id, client_id, delivery_type, booked_at, slot_id, delivery_slots(starts_at, ends_at, delivery_availabilities(delivery_locations(name, address)))")
    .eq("status", "BOOKED")
    .is("confirmed_at", null)
    .order("booked_at")
    .limit(300);
  if (error) {
    if (isMissingDeliveryRequestsSchema(error.message)) return { available: false, requests: [] };
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as Array<{ id: string; visit_id: string; ticket_id: string; client_id: string; delivery_type: string; booked_at: string; delivery_slots: unknown }>;
  if (!rows.length) return { available: true, requests: [] };

  const ticketIds = [...new Set(rows.map((r) => r.ticket_id))];
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const [tickets, clients] = await Promise.all([
    db.from("tickets").select("id, ticket_number, product_id, product_name_snapshot, variant_name_snapshot, image_storage_key_snapshot, agreed_total_cents, paid_principal_cents, financial_status").in("id", ticketIds),
    db.from("clients").select("id, first_name, last_name, phone").in("id", clientIds),
  ]);
  if (tickets.error) throw new Error(tickets.error.message);
  if (clients.error) throw new Error(clients.error.message);
  const ticketRows = (tickets.data ?? []) as Array<{ id: string; ticket_number: string; product_id: string | null; product_name_snapshot: string; variant_name_snapshot: string | null; image_storage_key_snapshot: string | null; agreed_total_cents: number; paid_principal_cents: number; financial_status: string }>;
  const productIds = [...new Set(ticketRows.filter((t) => !t.image_storage_key_snapshot && t.product_id).map((t) => t.product_id as string))];
  const imageByProduct = new Map<string, string>();
  if (productIds.length) {
    const { data: images } = await db.from("product_images").select("product_id, storage_key, sort_order").in("product_id", productIds).order("sort_order");
    for (const image of (images ?? []) as Array<{ product_id: string; storage_key: string }>) if (!imageByProduct.has(image.product_id)) imageByProduct.set(image.product_id, image.storage_key);
  }
  const ticketById = new Map(ticketRows.map((t) => [t.id, t]));
  const clientById = new Map(((clients.data ?? []) as Array<{ id: string; first_name: string; last_name: string; phone: string | null }>).map((c) => [c.id, c]));

  const visits = new Map<string, PendingRequest>();
  const now = Date.now();
  for (const row of rows) {
    const slot = first(row.delivery_slots as { starts_at: string; ends_at: string; delivery_availabilities: unknown } | null);
    if (!slot) continue;
    const location = first(first(slot.delivery_availabilities as { delivery_locations: unknown } | null)?.delivery_locations as { name: string; address: string } | null);
    let visit = visits.get(row.visit_id);
    if (!visit) {
      const client = clientById.get(row.client_id);
      visit = {
        visitId: row.visit_id, clientId: row.client_id,
        clientName: client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta",
        clientPhone: client?.phone ?? null,
        startsAt: slot.starts_at, endsAt: slot.ends_at,
        locationName: location?.name ?? "Punto de entrega", locationAddress: location?.address ?? "",
        deliveryType: row.delivery_type, requestedAt: row.booked_at,
        expired: new Date(slot.starts_at).getTime() <= now,
        items: [], balanceCents: 0,
      };
      visits.set(row.visit_id, visit);
    }
    if (row.booked_at < visit.requestedAt) visit.requestedAt = row.booked_at;
    const ticket = ticketById.get(row.ticket_id);
    const balance = ticket && !["CANCELLED_INCIDENT", "REFUND_PENDING", "REFUNDED"].includes(ticket.financial_status) ? Math.max(0, Number(ticket.agreed_total_cents) - Number(ticket.paid_principal_cents)) : 0;
    visit.items.push({
      bookingId: row.id, ticketId: row.ticket_id,
      ticketNumber: ticket?.ticket_number ?? "—",
      productName: ticket?.product_name_snapshot ?? "Producto",
      variantName: ticket?.variant_name_snapshot ?? null,
      imageUrl: productImageUrl(ticket?.image_storage_key_snapshot ?? (ticket?.product_id ? imageByProduct.get(ticket.product_id) : null)),
      balanceCents: balance,
    });
    visit.balanceCents += balance;
  }
  for (const visit of visits.values()) visit.items.sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber));
  return { available: true, requests: [...visits.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
}

/** Number of visits waiting for the owner (sidebar badge). 0 on any error or without 020. */
export async function countPendingRequests(): Promise<number> {
  try {
    const { data, error } = await adminDb().from("delivery_bookings").select("visit_id").eq("status", "BOOKED").is("confirmed_at", null).limit(500);
    if (error) return 0;
    return new Set(((data ?? []) as Array<{ visit_id: string }>).map((row) => row.visit_id)).size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Owner: confirm / reject. The SQL function writes the in-app notice in the
// same transaction; Telegram is best-effort afterwards.
// ---------------------------------------------------------------------------

type DecisionResult = { ok: true; clientId: string; title: string; body: string; ticketIds: string[] } | { ok: false; error: string };

function friendly(error: { message?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  if (message.startsWith("LF: ")) return message.slice(4);
  if (isMissingDeliveryRequestsSchema(message) || /Could not find the function/.test(message)) return `Falta aplicar ${DELIVERY_REQUESTS_MIGRATION} en el editor SQL de Supabase.`;
  return message || fallback;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function telegram(clientId: string, title: string, body: string, icon: string) {
  try {
    const { data } = await adminDb().from("clients").select("telegram_chat_id").eq("id", clientId).maybeSingle();
    if (data?.telegram_chat_id) await sendTelegramMessage(data.telegram_chat_id as string, `${icon} <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`);
  } catch {
    // Best-effort, like every other notice.
  }
}

async function decide(fn: "confirm_delivery_request" | "reject_delivery_request", args: Record<string, string>, icon: string, fallback: string): Promise<DecisionResult> {
  const { data, error } = await adminDb().rpc(fn, args);
  if (error) return { ok: false, error: friendly(error, fallback) };
  const result = (data ?? {}) as { clientId?: string; title?: string; body?: string; ticketIds?: string[] };
  if (!result.clientId) return { ok: false, error: fallback };
  await telegram(result.clientId, result.title ?? "", result.body ?? "", icon);
  return { ok: true, clientId: result.clientId, title: result.title ?? "", body: result.body ?? "", ticketIds: result.ticketIds ?? [] };
}

export function confirmDeliveryRequest(visitId: string, adminId: string) {
  return decide("confirm_delivery_request", { p_visit_id: visitId, p_admin_id: adminId }, "✅", "No fue posible confirmar la solicitud.");
}

export function rejectDeliveryRequest(visitId: string, adminId: string, reason: string) {
  return decide("reject_delivery_request", { p_visit_id: visitId, p_admin_id: adminId, p_reason: reason }, "⚠️", "No fue posible rechazar la solicitud.");
}
