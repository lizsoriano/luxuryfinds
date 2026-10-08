import { buildAccountOverview, type AccountRaw, type RawBooking, type RawFee, type RawInstallment, type RawNotification, type RawOrder, type RawPlan, type RawProof, type RawSlotInfo, type RawTicket } from "../account-view";
import { getClientProfile } from "./auth";
import { adminDb, adminStorage, PRODUCT_IMAGE_BUCKET } from "./business";
import { getClientReservations } from "./incoming-reservations";
import { getSaleItemFulfillment, related } from "./sales";

// ---------------------------------------------------------------------------
// The client's panel data. Security model:
//  1. getClientProfile() verifies the session with Supabase Auth (auth.getUser).
//  2. Rows a client may read under RLS (orders, tickets, plans, installments,
//     late fees, proofs, bookings, notifications) are read WITH HER SESSION.
//  3. Rows without a client policy (sales, sale items, payments, images, slot
//     details, shipment ETA) are read with the service role, but ONLY filtered
//     by her verified user id or by ids that came out of step 2 — never by an
//     id from the request. Columns are an allowlist: no costs, commissions,
//     internal notes, carriers, tracking numbers or shopper data.
// ---------------------------------------------------------------------------

const TICKET_COLUMNS = "id, order_item_id, ticket_number, product_id, product_name_snapshot, variant_name_snapshot, image_storage_key_snapshot, quantity, cash_unit_price_cents, agreed_total_cents, discount_cents, payment_mode, financial_status, logistics_status, paid_principal_cents, incident_reason, created_at, updated_at";

export function productImageUrl(key: string | null | undefined) {
  return key ? adminStorage().from(PRODUCT_IMAGE_BUCKET).getPublicUrl(key).data.publicUrl : null;
}

type Result<T> = { data: T[] | null; error: { message: string } | null };
function rows<T>(name: string, result: Result<T>, optional = false): T[] {
  if (result.error) {
    if (optional) { console.error(`[cuenta] ${name}: ${result.error.message}`); return []; }
    throw new Error(`No fue posible cargar ${name}: ${result.error.message}`);
  }
  return result.data ?? [];
}

/** Estimated arrival of the shipment each (shopper-assigned) ticket travels in. Dates only. */
async function shipmentEtas(ticketIds: string[]) {
  const map: Record<string, string> = {};
  if (!ticketIds.length) return map;
  try {
    const assignments = await related<{ id: string; ticket_id: string; status: string }>("purchase_assignments", "id,ticket_id,status", "ticket_id", ticketIds);
    const active = assignments.filter((a) => a.status === "ACTIVE");
    if (!active.length) return map;
    const lines = (await related<{ id: string; assignment_id: string; shipment_id: string; status: string }>("shipment_lines", "id,assignment_id,shipment_id,status", "assignment_id", active.map((a) => a.id))).filter((l) => l.status === "ACTIVE");
    const shipments = await related<{ id: string; status: string; estimated_arrival: string | null }>("shipments", "id,status,estimated_arrival", "id", lines.map((l) => l.shipment_id));
    for (const line of lines) {
      const shipment = shipments.find((s) => s.id === line.shipment_id);
      const assignment = active.find((a) => a.id === line.assignment_id);
      if (assignment && shipment?.estimated_arrival && ["IN_TRANSIT", "PARTIALLY_RECEIVED", "DRAFT"].includes(shipment.status)) map[assignment.ticket_id] = shipment.estimated_arrival;
    }
  } catch (error) {
    // Migrations 011/014 missing or a transient error: the ETA is a nice-to-have.
    if (!(error instanceof Error && /PGRST205|does not exist|schema cache|Could not find/.test(error.message))) console.error("[cuenta] eta", error);
  }
  return map;
}

async function slotDetails(slotIds: string[]): Promise<RawSlotInfo[]> {
  if (!slotIds.length) return [];
  const result: RawSlotInfo[] = [];
  const unique = [...new Set(slotIds)];
  for (let start = 0; start < unique.length; start += 150) {
    const { data, error } = await adminDb().from("delivery_slots").select("id, starts_at, ends_at, delivery_availabilities(location_id, delivery_locations(name, address))").in("id", unique.slice(start, start + 150));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Array<{ id: string; starts_at: string; ends_at: string; delivery_availabilities: { delivery_locations: { name: string; address: string } | null } | null }>) {
      const location = row.delivery_availabilities?.delivery_locations ?? null;
      result.push({ id: row.id, starts_at: row.starts_at, ends_at: row.ends_at, location_name: location?.name ?? "Punto de entrega", location_address: location?.address ?? "" });
    }
  }
  return result;
}

export async function getAccountOverview() {
  const { supabase, user, profile } = await getClientProfile();
  if (!profile) return { user, profile: null, overview: null, telegramLinked: false, address: null as string | null };
  const db = supabase.schema("luxury_finds");

  const [orders, tickets, plans, installments, fees, notifications, bookings, proofs, clientRow, reservations] = await Promise.all([
    db.from("orders").select("id, status, created_at, confirmed_at, cancelled_at, origin").eq("client_id", user.id).order("created_at", { ascending: false }),
    db.from("tickets").select(TICKET_COLUMNS).eq("client_id", user.id).order("created_at", { ascending: false }),
    db.from("payment_plans").select("id, ticket_id, mode, status, agreed_total_cents, number_of_weeks, start_date, due_date"),
    db.from("installments").select("id, payment_plan_id, installment_number, due_at, amount_cents, paid_cents, status").order("due_at"),
    db.from("late_fees").select("id, ticket_id, amount_cents, paid_cents, status"),
    db.from("notifications").select("id, ticket_id, type, title, body, read_at, created_at").eq("client_id", user.id).order("created_at", { ascending: false }).limit(60),
    db.from("delivery_bookings").select("id, ticket_id, slot_id, delivery_type, status, booked_at, cancellation_reason").eq("client_id", user.id).order("booked_at", { ascending: false }),
    db.from("payment_proofs").select("id, ticket_id, reported_amount_cents, payment_method, status, rejection_reason, uploaded_at").order("uploaded_at", { ascending: false }),
    db.from("clients").select("address").eq("id", user.id).maybeSingle(),
    getClientReservations(user.id).catch(() => [] as Array<{ id: string; ticket_id: string; status: string; expires_at: string }>),
  ]);

  const orderRows = rows<RawOrder>("tus pedidos", orders as Result<RawOrder>);
  const ticketRows = rows<RawTicket>("tus tickets", tickets as Result<RawTicket>);
  const ownTicketIds = new Set(ticketRows.map((t) => t.id));
  const ownOrderIds = orderRows.map((o) => o.id);

  // Service-role reads, scoped to her verified id or to ids her own session returned.
  const [orderItems, sales, payments, telegram] = await Promise.all([
    related<AccountRaw["orderItems"][number]>("order_items", "id,order_id,product_id,quantity,unit_price_cents,products(name),product_variants(name)", "order_id", ownOrderIds),
    related<AccountRaw["sales"][number] & { client_id: string }>("sales", "id,sale_number,status,sold_at,subtotal_cents,discount_cents,total_cents,payment_method,sale_type,concept,client_id", "client_id", [user.id]),
    related<AccountRaw["payments"][number]>("payments", "id,ticket_id,amount_cents,method,effective_paid_at", "ticket_id", [...ownTicketIds]),
    adminDb().from("clients").select("telegram_chat_id").eq("id", user.id).maybeSingle(),
  ]);
  const ownSales = sales.filter((s) => s.client_id === user.id);
  const saleItems = await related<AccountRaw["saleItems"][number]>("sale_items", "id,sale_id,product_id,product_name_snapshot,variant_name_snapshot,quantity,unit_price_cents,total_cents,unit_label", "sale_id", ownSales.map((s) => s.id));
  const bookingRows = rows<RawBooking>("tus entregas", bookings as Result<RawBooking>).filter((b) => ownTicketIds.has(b.ticket_id));
  const productIds = [...new Set([...ticketRows, ...orderItems, ...saleItems].flatMap((row) => row.product_id ? [row.product_id] : []))];
  const [fulfillment, images, slots, etaByTicket] = await Promise.all([
    getSaleItemFulfillment(saleItems.map((i) => i.id)),
    related<{ id: string; product_id: string; storage_key: string; sort_order: number }>("product_images", "id,product_id,storage_key,sort_order", "product_id", productIds),
    slotDetails(bookingRows.map((b) => b.slot_id)),
    shipmentEtas(ticketRows.filter((t) => ["ORDERED", "IN_TRANSIT"].includes(t.logistics_status)).map((t) => t.id)),
  ]);
  const imageByProduct: Record<string, string> = {};
  for (const image of [...images].sort((a, b) => a.sort_order - b.sort_order)) imageByProduct[image.product_id] ??= image.storage_key;

  const planRows = rows<RawPlan>("tus planes", plans as Result<RawPlan>).filter((p) => ownTicketIds.has(p.ticket_id));
  const ownPlanIds = new Set(planRows.map((p) => p.id));
  const raw: AccountRaw = {
    orders: orderRows,
    orderItems,
    tickets: ticketRows,
    sales: ownSales,
    saleItems,
    fulfillment: fulfillment.rows,
    plans: planRows,
    installments: rows<RawInstallment>("tus pagos programados", installments as Result<RawInstallment>).filter((i) => ownPlanIds.has(i.payment_plan_id)),
    fees: rows<RawFee>("tus cargos", fees as Result<RawFee>, true).filter((f) => ownTicketIds.has(f.ticket_id)),
    payments,
    proofs: rows<RawProof>("tus comprobantes", proofs as Result<RawProof>, true).filter((p) => ownTicketIds.has(p.ticket_id)),
    bookings: bookingRows,
    slots,
    notifications: rows<RawNotification>("tus avisos", notifications as Result<RawNotification>, true),
    reservations: reservations.filter((r) => ownTicketIds.has(r.ticket_id)),
    etaByTicket,
    imageByProduct,
  };
  const overview = buildAccountOverview(raw, productImageUrl);
  return {
    user,
    profile,
    overview,
    telegramLinked: Boolean(telegram.data?.telegram_chat_id),
    address: ((clientRow as { data: { address: string | null } | null }).data?.address ?? null),
  };
}

