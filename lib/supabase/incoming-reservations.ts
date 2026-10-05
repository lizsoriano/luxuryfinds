import { adminDb, adminStorage, DEFAULT_BUSINESS_ID, PRODUCT_IMAGE_BUCKET } from "./business";
import { sendTelegramMessage } from "../telegram/send";
export const RESERVATIONS_MIGRATION = "database/migrations/016_incoming_reservations.sql";
export const RESERVATIONS_UNAVAILABLE = `Falta aplicar ${RESERVATIONS_MIGRATION} en el editor SQL de Supabase, después de 010–014.`;
export function isMissingReservations(message: string) {
  return /incoming_|purchase_reservations|reservation_|expire_purchase/.test(message) && /schema cache|does not exist|Could not find/.test(message);
}
export function reservationError(error: { message: string }) { return isMissingReservations(error.message) ? RESERVATIONS_UNAVAILABLE : error.message; }
export type IncomingItem = { purchase_item_id: string; name: string; variant_label: string | null; purchase_number: string; available_quantity: number; reserved_pending_quantity: number; received_quantity: number; assigned_quantity: number; unit_price_cents: number | null; estimated_arrival: string | null; photo_storage_key: string | null; original_photo_storage_key: string | null; is_public: boolean | null; photoUrl: string | null };
export type ReservationRow = { id: string; ticket_id: string; quantity: number; unit_price_cents: number; initial_payment_cents: number; stock_allocated_quantity: number; status: string; expires_at: string; created_at: string; closure_reason: string | null; tickets: { ticket_number: string; product_name_snapshot: string; agreed_total_cents: number; paid_principal_cents: number; logistics_status: string; financial_status: string }; clients: { first_name: string; last_name: string } };
export async function expireReservations(limit = 100) {
  const { data, error } = await adminDb().rpc("expire_purchase_reservations", { p_limit: limit });
  if (error && isMissingReservations(error.message)) return { available: false, expired: 0 };
  if (error) throw new Error(reservationError(error));
  return { available: true, expired: Number(data ?? 0) };
}
export async function listIncomingItems(page = 1, search = "") {
  const expiration = await expireReservations();
  if (!expiration.available) return { items: [] as IncomingItem[], hasNext: false, error: RESERVATIONS_UNAVAILABLE };
  const from = (Math.max(1, page) - 1) * 30;
  let query = adminDb().from("incoming_item_availability").select("purchase_item_id,name,variant_label,purchase_number,available_quantity,reserved_pending_quantity,received_quantity,assigned_quantity,unit_price_cents,estimated_arrival,photo_storage_key,original_photo_storage_key,is_public", { count: "exact" }).eq("business_id", DEFAULT_BUSINESS_ID);
  if (search.trim()) query = query.ilike("name", `%${search.trim().slice(0, 80)}%`);
  const { data, error, count } = await query.order("name").order("purchase_item_id").range(from, from + 29);
  if (error) throw new Error(reservationError(error));
  return { items: (data ?? []).map((row) => ({ ...row, photoUrl: photoUrl(row.photo_storage_key ?? row.original_photo_storage_key) })) as IncomingItem[], hasNext: (count ?? 0) > from + 30, error: null };
}
export function photoUrl(key: string | null) { return key ? adminStorage().from(PRODUCT_IMAGE_BUCKET).getPublicUrl(key).data.publicUrl : null; }
export async function listPublicIncoming(page = 1) {
  // View already excludes expired unpaid holds at their exact deadline; this
  // materialises the release and in-app notice when someone visits the page.
  const expiry = await expireReservations();
  if (!expiry.available) return { items: [] as Array<{ purchase_item_id: string; name: string; variant_label: string | null; unit_price_cents: number; estimated_arrival: string | null; available_quantity: number; photoUrl: string | null }>, hasNext: false };
  const from = (page - 1) * 24;
  const { data, error, count } = await adminDb().from("incoming_item_availability").select("purchase_item_id,name,variant_label,unit_price_cents,estimated_arrival,available_quantity,photo_storage_key", { count: "exact" }).eq("business_id", DEFAULT_BUSINESS_ID).eq("is_public", true).gt("available_quantity", 0).gt("unit_price_cents", 0).order("name").order("purchase_item_id").range(from, from + 23);
  if (error) throw new Error(reservationError(error));
  return { items: (data ?? []).map(({ photo_storage_key, ...row }) => ({ ...row, photoUrl: photoUrl(photo_storage_key) })), hasNext: (count ?? 0) > from + 24 };
}
export async function listReservations(page = 1, status = "") {
  const expiry = await expireReservations();
  if (!expiry.available) return { reservations: [] as ReservationRow[], hasNext: false, error: RESERVATIONS_UNAVAILABLE };
  const from = (page - 1) * 30;
  let query = adminDb().from("purchase_reservations").select("id,ticket_id,quantity,unit_price_cents,initial_payment_cents,stock_allocated_quantity,status,expires_at,created_at,closure_reason,tickets(ticket_number,product_name_snapshot,agreed_total_cents,paid_principal_cents,logistics_status,financial_status),clients(first_name,last_name)", { count: "exact" });
  if (["ACTIVE", "PAID", "EXPIRED", "CANCELLED"].includes(status)) query = query.eq("status", status);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id").range(from, from + 29);
  if (error) throw new Error(reservationError(error));
  return { reservations: (data ?? []) as unknown as ReservationRow[], hasNext: (count ?? 0) > from + 30, error: null };
}
/** Called only after getClientProfile authenticates the client; no costs returned. */
export async function getClientReservations(clientId: string) {
  const expiry = await expireReservations();
  if (!expiry.available) return [] as Array<{ id: string; ticket_id: string; status: string; expires_at: string }>;
  const { data, error } = await adminDb().from("purchase_reservations").select("id,ticket_id,status,expires_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(reservationError(error));
  return (data ?? []) as Array<{ id: string; ticket_id: string; status: string; expires_at: string }>;
}
export async function hasReservationTickets(ids: string[]) {
  for (let offset = 0; offset < ids.length; offset += 150) {
    const { data, error } = await adminDb().from("purchase_reservations").select("id").in("ticket_id", ids.slice(offset, offset + 150)).limit(1);
    if (error && isMissingReservations(error.message)) return false;
    if (error) throw new Error(reservationError(error));
    if (data?.length) return true;
  }
  return false;
}
export async function processReservationExpiry(budgetMs = 8000) {
  const start = Date.now();
  const expiry = await expireReservations(200);
  if (!expiry.available) return { ...expiry, sent: 0 };
  const { data, error } = await adminDb().rpc("claim_reservation_notifications", { p_limit: 10 });
  if (error) throw new Error(reservationError(error));
  let sent = 0;
  for (const notice of (data ?? []) as Array<{ reservation_id: string; claim_token: string; chat_id: string | null; body: string }>) {
    if (Date.now() - start > budgetMs - 1000) break; // unused leases become retryable
    const delivered = !notice.chat_id || await sendTelegramMessage(notice.chat_id, notice.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), Math.max(500, Math.min(2500, budgetMs - (Date.now() - start) - 500)));
    const done = await adminDb().rpc("finish_reservation_notification", { p_id: notice.reservation_id, p_token: notice.claim_token, p_sent: delivered });
    if (done.error) throw new Error(reservationError(done.error));
    if (delivered && notice.chat_id) sent += 1;
  }
  return { ...expiry, sent };
}
