import { adminDb, adminStorage, PRODUCT_IMAGE_BUCKET } from "./business";
import { LOGISTICS_STATUS_LABELS } from "../format";
import { buildOrderIndexRow, buildSaleIndexRow, countIndexRows, foldSearchText, orderPayment, pageIndexRows, resolveSalesFilter, salePayment, type SalesFeedIndexRow, type SalesFeedCounts, type StageTicket } from "../sales-feed";

export const SALES_MIGRATION = "database/migrations/017_sales_feed_tracking.sql";
export const FULFILLMENT_MIGRATION = "database/migrations/018_sale_item_fulfillment.sql";
export type SaleItemFulfillment = { id: string; logistics_status: string; updated_at: string };
export async function getSaleItemFulfillment(ids: string[]) {
  const rows: SaleItemFulfillment[] = [];
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 150) {
    const { data, error } = await adminDb().from("sale_item_fulfillment").select("id,logistics_status,updated_at").in("id", unique.slice(start,start+150)).limit(150);
    if (missingRelation(error)) return { rows: [] as SaleItemFulfillment[], available: false };
    check(error); rows.push(...(data ?? []) as SaleItemFulfillment[]);
  }
  return { rows, available: true };
}
export const SALES_PAGE_SIZE = 20;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function salesTarget(value: string) {
  const id = value.slice(2);
  if (!UUID.test(id) || !/^[sp]-/.test(value)) return null;
  return { id, kind: value.startsWith("s-") ? "SALE" as const : "ORDER" as const, table: value.startsWith("s-") ? "sales" : "orders", column: value.startsWith("s-") ? "sale_id" : "order_id" };
}
export function saleHref(row: Pick<SalesFeedIndexRow, "kind" | "id">) { return `/admin/vender/${row.kind === "SALE" ? "s" : "p"}-${row.id}`; }
export function missingRelation(error: { code?: string; message?: string } | null) { return !!error && ["PGRST205", "42P01"].includes(error.code ?? ""); }
function check(error: { message: string } | null) { if (error) throw new Error(error.message); }

/** All child reads are paginated and UUID batches never exceed 150. */
export async function related<T>(table: string, select: string, column: string, ids: string[]): Promise<T[]> {
  const result: T[] = [];
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 150) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await adminDb().from(table).select(select).in(column, unique.slice(start, start + 150)).order("id").range(offset, offset + 999);
      check(error);
      result.push(...(data ?? []) as unknown as T[]);
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return result;
}

type Client = { id: string; first_name: string; last_name: string; phone: string; email: string | null; address: string | null };
type Sale = { id: string; sale_number: string; sold_at: string; client_id: string | null; status: string; concept: string | null; sale_type: string; payment_method: string; subtotal_cents: number; discount_cents: number; total_cents: number; notes: string | null; cancelled_at: string | null };
type Order = { id: string; client_id: string; status: string; created_at: string; origin: string; internal_notes: string | null; confirmed_at: string | null; cancelled_at: string | null };
type Item = { id: string; sale_id?: string; order_id?: string; product_id: string | null; quantity: number; unit_price_cents: number; total_cents?: number; product_name_snapshot?: string; variant_name_snapshot?: string | null; sku_snapshot?: string | null; products?: { name: string } | null; product_variants?: { name: string } | null };
export type Ticket = StageTicket & { id: string; order_item_id: string; ticket_number: string; product_name_snapshot: string; variant_name_snapshot: string | null; financial_status: string; created_at: string; updated_at: string; image_storage_key_snapshot: string | null };
type Payment = { id: string; ticket_id: string; amount_cents: number; method: string; effective_paid_at: string };
type Refund = { id: string; refund_request_id: string; amount_cents: number; refunded_at: string; method: string };
export type SalesLine = { id: string; productId: string | null; name: string; variant: string | null; quantity: number; unitCents: number; totalCents: number; image: string | null; logisticsStatus: string | null; statusUpdatedAt: string | null; ticketId: string | null };
export type SalesRecord = { index: SalesFeedIndexRow; client: Client | null; lines: SalesLine[]; fulfillmentAvailable: boolean; totalCents: number; subtotalCents: number; discountCents: number; paidCents: number; refundCents: number; notes: string | null; status: string; channel: string; confirmedAt: string | null; cancelledAt: string | null; tickets: Ticket[]; payments: Payment[]; refunds: Refund[]; payment: ReturnType<typeof salePayment>; };

const SALE_SELECT = "id,sale_number,sold_at,client_id,status,concept,sale_type,payment_method,subtotal_cents,discount_cents,total_cents,notes,cancelled_at";
const ORDER_SELECT = "id,client_id,status,created_at,origin,internal_notes,confirmed_at,cancelled_at";
function imageUrl(key: string | null | undefined) { return key ? adminStorage().from(PRODUCT_IMAGE_BUCKET).getPublicUrl(key).data.publicUrl : null; }

async function hydrate(sales: Sale[], orders: Order[]): Promise<SalesRecord[]> {
  const [saleItems, orderItems, clients] = await Promise.all([
    related<Item>("sale_items", "id,sale_id,product_id,quantity,unit_price_cents,total_cents,product_name_snapshot,variant_name_snapshot,sku_snapshot", "sale_id", sales.map(s => s.id)),
    related<Item>("order_items", "id,order_id,product_id,quantity,unit_price_cents,products(name),product_variants(name)", "order_id", orders.map(o => o.id)),
    related<Client>("clients", "id,first_name,last_name,phone,email,address", "id", [...sales, ...orders].flatMap(r => r.client_id ? [r.client_id] : [])),
  ]);
  const [tickets, images, plans, fulfillment] = await Promise.all([
    related<Ticket>("tickets", "id,order_item_id,ticket_number,product_name_snapshot,variant_name_snapshot,financial_status,logistics_status,agreed_total_cents,paid_principal_cents,created_at,updated_at,image_storage_key_snapshot", "order_item_id", orderItems.map(i => i.id)),
    related<{ id: string; product_id: string; storage_key: string; sort_order: number }>("product_images", "id,product_id,storage_key,sort_order", "product_id", [...saleItems, ...orderItems].flatMap(i => i.product_id ? [i.product_id] : [])),
    related<{ id: string; requested_number_of_weeks: number | null }>("orders", "id,requested_number_of_weeks", "id", orders.map(o => o.id)).catch(() => []),
    getSaleItemFulfillment(saleItems.map(i => i.id)),
  ]);
  const [payments, requests, proofs, ticketPlans] = await Promise.all([
    related<Payment>("payments", "id,ticket_id,amount_cents,method,effective_paid_at", "ticket_id", tickets.map(t => t.id)),
    related<{ id: string; ticket_id: string }>("refund_requests", "id,ticket_id", "ticket_id", tickets.map(t => t.id)),
    related<{ id: string; ticket_id: string; status: string }>("payment_proofs", "id,ticket_id,status", "ticket_id", tickets.map(t => t.id)),
    related<{ id: string; ticket_id: string; number_of_weeks: number | null }>("payment_plans", "id,ticket_id,number_of_weeks", "ticket_id", tickets.map(t => t.id)),
  ]);
  const refunds = await related<Refund>("refunds", "id,refund_request_id,amount_cents,refunded_at,method", "refund_request_id", requests.map(r => r.id));
  const imageMap = new Map<string, string>();
  for (const image of images.sort((a, b) => a.sort_order - b.sort_order)) if (!imageMap.has(image.product_id)) imageMap.set(image.product_id, image.storage_key);
  const clientMap = new Map(clients.map(c => [c.id, c]));
  function lines(items: Item[], liveTickets: Ticket[]) {
    return items.map(i => {
      const ticket = liveTickets.find(t => t.order_item_id === i.id);
      const physical = fulfillment.rows.find(f => f.id === i.id);
      return { id: i.id, productId: i.product_id, name: i.product_name_snapshot ?? ticket?.product_name_snapshot ?? i.products?.name ?? "Artículo sin producto", variant: i.variant_name_snapshot ?? ticket?.variant_name_snapshot ?? i.product_variants?.name ?? null, quantity: Number(i.quantity), unitCents: Number(i.unit_price_cents), totalCents: Number(i.total_cents ?? Number(i.quantity) * Number(i.unit_price_cents)), image: imageUrl(ticket?.image_storage_key_snapshot ?? (i.product_id ? imageMap.get(i.product_id) : null)), logisticsStatus: i.sale_id ? physical?.logistics_status ?? "DELIVERED" : ticket?.logistics_status ?? null, statusUpdatedAt: physical?.updated_at ?? ticket?.updated_at ?? null, ticketId: ticket?.id ?? null };
    });
  }
  return [
    ...sales.map(s => {
      const items = saleItems.filter(i => i.sale_id === s.id);
      const client = clientMap.get(s.client_id ?? "") ?? null;
      return { index: buildSaleIndexRow(s, client, items.map(i => ({ product_name_snapshot: i.product_name_snapshot ?? null, variant_name_snapshot: i.variant_name_snapshot ?? null, sku_snapshot: i.sku_snapshot ?? null })), lines(items, []).map(i => i.logisticsStatus ?? "DELIVERED")), fulfillmentAvailable: fulfillment.available, client, lines: lines(items, []), totalCents: Number(s.total_cents), subtotalCents: Number(s.subtotal_cents), discountCents: Number(s.discount_cents), paidCents: Number(s.total_cents), refundCents: 0, notes: s.notes, status: s.status, channel: "Mostrador", confirmedAt: null, cancelledAt: s.cancelled_at, tickets: [], payments: [], refunds: [], payment: salePayment(s) };
    }),
    ...orders.map(o => {
      const items = orderItems.filter(i => i.order_id === o.id);
      const ids = new Set(items.map(i => i.id));
      const orderTickets = tickets.filter(t => ids.has(t.order_item_id));
      const ticketIds = new Set(orderTickets.map(t => t.id));
      const orderPayments = payments.filter(p => ticketIds.has(p.ticket_id));
      const requestIds = new Set(requests.filter(r => ticketIds.has(r.ticket_id)).map(r => r.id));
      const orderRefunds = refunds.filter(r => requestIds.has(r.refund_request_id));
      const refundCents = orderRefunds.reduce((n, r) => n + Number(r.amount_cents), 0);
      const client = clientMap.get(o.client_id) ?? null;
      const index = buildOrderIndexRow(o, client, items.map(i => ({ product_name: i.products?.name ?? null, variant_name: i.product_variants?.name ?? null, ticket: orderTickets.find(t => t.order_item_id === i.id) ?? null })));
      const orderLines = lines(items, orderTickets);
      const totalCents = orderTickets.length ? orderTickets.reduce((n,t) => n + Number(t.agreed_total_cents), 0) : orderLines.reduce((n,i) => n + i.totalCents, 0);
      return { index, fulfillmentAvailable: true, client, lines: orderLines, totalCents, subtotalCents: orderLines.reduce((n,i) => n + i.totalCents, 0), discountCents: 0, paidCents: orderPayments.reduce((n,p) => n + Number(p.amount_cents), 0), refundCents, notes: o.internal_notes, status: o.status, channel: o.origin === "WEBSITE" ? "Web" : "Pedido manual", confirmedAt: o.confirmed_at, cancelledAt: o.cancelled_at, tickets: orderTickets, payments: orderPayments, refunds: orderRefunds, payment: orderPayment({ orderStatus: o.status, stage: index.stage, tickets: orderTickets, refundedCents: refundCents, pendingProofs: proofs.filter(p => ticketIds.has(p.ticket_id) && p.status === "PENDING").length, methods: orderPayments.map(p => p.method), requestedWeeks: plans.find(p => p.id === o.id)?.requested_number_of_weeks ?? null, planWeeks: ticketPlans.find(p => ticketIds.has(p.ticket_id))?.number_of_weeks ?? null }) };
    }),
  ];
}

export type SalesQuery = { search: string; filter: string; ascending: boolean; page: number };
export async function listSales(query: SalesQuery): Promise<{ records: SalesRecord[]; counts: SalesFeedCounts; total: number; fallback: boolean }> {
  const filter = resolveSalesFilter(query.filter);
  let request = adminDb().from("sales_feed").select("*", { count: "exact" });
  if (filter.stage) request = request.eq("stage", filter.stage);
  if (filter.toCollect) request = request.eq("to_collect", true).neq("stage", "CANCELLED");
  const search = foldSearchText(query.search.trim()).replace(/[\\%_]/g, "\\$&");
  if (search) request = request.ilike("search_text", `%${search}%`);
  const [feed, countsResult] = await Promise.all([
    request.order("occurred_at", { ascending: query.ascending }).order("id", { ascending: query.ascending }).order("kind").range((query.page - 1) * SALES_PAGE_SIZE, query.page * SALES_PAGE_SIZE - 1),
    adminDb().from("sales_feed_counts").select("*").single(),
  ]);
  if (missingRelation(feed.error) || missingRelation(countsResult.error)) {
    const [sales, orders] = await Promise.all([
      adminDb().from("sales").select(SALE_SELECT).order("sold_at", { ascending: false }).limit(1000),
      adminDb().from("orders").select(ORDER_SELECT).order("created_at", { ascending: false }).limit(1000),
    ]);
    check(sales.error); check(orders.error);
    const records = await hydrate((sales.data ?? []) as Sale[], (orders.data ?? []) as Order[]);
    const page = pageIndexRows(records.map(r => r.index), { ...query, pageSize: SALES_PAGE_SIZE });
    return { records: page.rows.map(i => records.find(r => r.index.kind === i.kind && r.index.id === i.id)!), total: page.total, counts: countIndexRows(records.map(r => r.index)), fallback: true };
  }
  check(feed.error); check(countsResult.error);
  const indexes = (feed.data ?? []) as SalesFeedIndexRow[];
  const [sales, orders] = await Promise.all([
    related<Sale>("sales", SALE_SELECT, "id", indexes.filter(r => r.kind === "SALE").map(r => r.id)),
    related<Order>("orders", ORDER_SELECT, "id", indexes.filter(r => r.kind === "ORDER").map(r => r.id)),
  ]);
  const records = await hydrate(sales, orders);
  return { records: indexes.flatMap(i => { const r = records.find(r => r.index.kind === i.kind && r.index.id === i.id); return r ? [{ ...r, index: i }] : []; }), total: feed.count ?? 0, counts: countsResult.data as SalesFeedCounts, fallback: false };
}

export async function getSalesRecord(value: string) {
  const target = salesTarget(value);
  if (!target) return null;
  const { data, error } = await adminDb().from(target.table).select(target.kind === "SALE" ? SALE_SELECT : ORDER_SELECT).eq("id", target.id).maybeSingle();
  check(error);
  if (!data) return null;
  return (await hydrate(target.kind === "SALE" ? [data as unknown as Sale] : [], target.kind === "ORDER" ? [data as unknown as Order] : []))[0];
}

export type HistoryEvent = { id: string; date: string; label: string };
export async function salesHistory(record: SalesRecord): Promise<HistoryEvent[]> {
  const ids = [record.index.id, ...record.tickets.map(t => t.id)];
  const logs = await related<{ id: string; entity_type: string; entity_id: string; action: string; created_at: string; new_data: { logistics_status?: string } | null; admin_users: { display_name: string } | null }>("activity_logs", "id,entity_type,entity_id,action,created_at,new_data,admin_users(display_name)", "entity_id", ids);
  const movements = await related<{ id: string; created_at: string; movement_type: string; quantity_delta: number }>("inventory_movements", "id,created_at,movement_type,quantity_delta", record.index.kind === "SALE" ? "sale_id" : "ticket_id", record.index.kind === "SALE" ? [record.index.id] : record.tickets.map(t => t.id));
  const events: HistoryEvent[] = [{ id: "created", date: record.index.occurred_at, label: "Venta creada" }];
  if (record.index.kind === "SALE") events.push({ id: "paid", date: record.index.occurred_at, label: `Pago recibido · ${record.payment.methodText}` });
  if (record.confirmedAt) events.push({ id: "confirmed", date: record.confirmedAt, label: "Pedido confirmado" });
  if (record.cancelledAt && !logs.some(l => ["SALE_CANCELLED", "ORDER_CANCELLED"].includes(l.action))) events.push({ id: "cancelled", date: record.cancelledAt, label: "Venta cancelada" });
  for (const log of logs) {
    if (log.entity_type !== (log.entity_id === record.index.id ? (record.index.kind === "SALE" ? "sales" : "orders") : "tickets")) continue;
    const status = log.new_data?.logistics_status;
    const labels: Record<string, string> = { SALE_ITEM_FULFILLMENT_UPDATED: `Estado del producto: ${status ? LOGISTICS_STATUS_LABELS[status] ?? status : "actualizado"}`, SALE_CANCELLED: "Cancelada", ORDER_CANCELLED: "Cancelada", TICKET_LOGISTICS_UPDATED: `Estado de entrega: ${status ? LOGISTICS_STATUS_LABELS[status] ?? status : "actualizado"}`, SALES_NOTES_UPDATED: "Notas actualizadas", SALES_TRACKING_CREATED: "Enlace de seguimiento creado", SALES_TRACKING_REVOKED: "Enlace de seguimiento desactivado" };
    if (labels[log.action]) events.push({ id: `log-${log.id}`, date: log.created_at, label: `${labels[log.action]}${log.admin_users?.display_name ? ` · Por ${log.admin_users.display_name}` : ""}` });
  }
  for (const m of movements) if (m.movement_type === "RELEASE" && Number(m.quantity_delta) > 0) events.push({ id: `stock-${m.id}`, date: m.created_at, label: `${m.quantity_delta} unidades devueltas al stock` });
  for (const ticket of record.tickets) {
    events.push({ id: `ticket-${ticket.id}`, date: ticket.created_at, label: `Ticket ${ticket.ticket_number} creado` });
    if (ticket.updated_at !== ticket.created_at) events.push({ id: `ticket-current-${ticket.id}`, date: ticket.updated_at, label: `Ticket ${ticket.ticket_number} actualizado · Estado actual: ${LOGISTICS_STATUS_LABELS[ticket.logistics_status] ?? ticket.logistics_status}` });
  }
  return events.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
