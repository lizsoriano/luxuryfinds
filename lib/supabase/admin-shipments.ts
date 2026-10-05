import { describeError } from "../actions";
import {
  DEFAULT_BUSINESS_ID,
  EXPENSE_RECEIPT_BUCKET,
  PRODUCT_IMAGE_BUCKET,
  adminDb,
  adminStorage,
  logActivity,
} from "./business";
import { isMissingAssignmentSchema, isMissingPurchaseSchema } from "./admin-purchases";
import {
  ASSIGNMENT_MIGRATION_FILE,
  PURCHASE_MIGRATION_FILE,
  SHIPMENT_MIGRATION_FILE,
  parseReceivedCount,
  parseShippingCostToCents,
} from "./purchase-math";
import { notifyTicketsLogistics, type TicketLogisticsNotice } from "./ticket-notifications";

// ---------------------------------------------------------------------------
// Compras con shopper, phase 3: shipments ("embarques") and reception in La
// Paz — shipments / shipment_lines / shipment_receipts, the views
// purchase_item_shipping / shipment_overview and the functions of
// database/migrations/014_shipments.sql. Every function takes the acting user's
// id explicitly (no session), so the flow runs from a script and the future
// employee panel can call receiveShipment() with its own actor. The SQL
// functions are the authority (locks, rules, money); this module validates for
// friendly messages, uploads photos, notifies clients and writes the activity
// log. Until 014 is applied (and 010/011 before it) reads report which file is
// missing and writes answer with a message naming it, instead of throwing.
// ---------------------------------------------------------------------------

export type ShipmentStatus = "DRAFT" | "IN_TRANSIT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export const SHIPMENT_STATUSES: ShipmentStatus[] = ["DRAFT", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: "En preparación",
  IN_TRANSIT: "En camino",
  PARTIALLY_RECEIVED: "Recibido en parte",
  RECEIVED: "Recibido",
  CANCELLED: "Cancelado",
};

export const SHIPMENT_STATUS_TONES: Record<ShipmentStatus, "neutral" | "rose" | "success" | "warning" | "danger"> = {
  DRAFT: "warning",
  IN_TRANSIT: "rose",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "neutral",
};

export type ShipmentSchemaState = "ready" | "missing-010" | "missing-011" | "missing-014";

export const SHIPMENTS_UNAVAILABLE_MESSAGE = `Falta aplicar ${SHIPMENT_MIGRATION_FILE} en el editor SQL de Supabase (después de la 010 y la 011).`;

export function shipmentUnavailableMessage(state: ShipmentSchemaState): string | null {
  if (state === "missing-010") {
    return `Faltan aplicar ${PURCHASE_MIGRATION_FILE}, ${ASSIGNMENT_MIGRATION_FILE} y ${SHIPMENT_MIGRATION_FILE}, en ese orden, en el editor SQL de Supabase.`;
  }
  if (state === "missing-011") {
    return `Faltan aplicar ${ASSIGNMENT_MIGRATION_FILE} y después ${SHIPMENT_MIGRATION_FILE} en el editor SQL de Supabase.`;
  }
  if (state === "missing-014") return SHIPMENTS_UNAVAILABLE_MESSAGE;
  return null;
}

const SHIPMENT_OBJECTS = [
  "shipments",
  "shipment_lines",
  "shipment_receipts",
  "purchase_item_shipping",
  "shipment_overview",
  "create_shipment",
  "add_shipment_lines",
  "remove_shipment_line",
  "update_shipment_header",
  "set_shipment_paid",
  "confirm_shipment_departure",
  "cancel_shipment",
  "receive_shipment",
];

export function isMissingShipmentSchema(message: string | null | undefined) {
  if (!message) return false;
  if (!SHIPMENT_OBJECTS.some((name) => message.includes(name))) return false;
  return message.includes("does not exist") || message.includes("schema cache") || message.includes("Could not find the");
}

/** When a phase 3 object is missing, tells which file is the first one missing. */
async function missingShipmentState(): Promise<Exclude<ShipmentSchemaState, "ready">> {
  const db = adminDb();
  const purchases = await db.from("purchases").select("id").limit(1);
  if (purchases.error && isMissingPurchaseSchema(purchases.error.message)) return "missing-010";
  const assignments = await db.from("purchase_assignments").select("id").limit(1);
  if (assignments.error && isMissingAssignmentSchema(assignments.error.message)) return "missing-011";
  return "missing-014";
}

function isMissingAnySchema(message: string | null | undefined) {
  return isMissingShipmentSchema(message) || isMissingAssignmentSchema(message) || isMissingPurchaseSchema(message);
}

async function describeShipmentError(error: unknown, fallback: string): Promise<string> {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (isMissingAnySchema(message)) return shipmentUnavailableMessage(await missingShipmentState()) ?? fallback;
  return describeError(error instanceof Error ? error : new Error(message || fallback), fallback);
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const num = (value: unknown) => Number(value ?? 0);
const text = (value: unknown) => String(value ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const PAGE_SIZE = 20;
const SIGNED_URL_SECONDS = 300;
/** Reception photos are compressed in the browser (~850 KB); this is the panel's usual cap. */
export const MAX_SHIPMENT_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function itemPhotoUrl(key: string | null) {
  if (!key) return null;
  return adminStorage().from(PRODUCT_IMAGE_BUCKET).getPublicUrl(key).data.publicUrl;
}

async function signedReceiptUrls(keys: string[]) {
  const urls = new Map<string, string>();
  if (!keys.length) return urls;
  try {
    const { data, error } = await adminStorage().from(EXPENSE_RECEIPT_BUCKET).createSignedUrls(keys, SIGNED_URL_SECONDS);
    if (error) return urls;
    for (const entry of data ?? []) if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  } catch {
    // A missing signature only hides the thumbnail.
  }
  return urls;
}

type ClientRef = { first_name: string; last_name: string; phone?: string | null };
type TicketRef = {
  ticket_number: string;
  logistics_status: string;
  financial_status?: string;
  incident_reason?: string | null;
  order_item_id?: string;
};

function clientName(client: ClientRef | null) {
  return client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ShipmentListRow = {
  id: string;
  shipment_number: string;
  carrier: string;
  tracking_number: string | null;
  shipping_cost_mxn_cents: number;
  estimated_arrival: string | null;
  status: ShipmentStatus;
  departed_at: string | null;
  received_at: string | null;
  paid: boolean;
  paid_on: string | null;
  created_at: string;
  cost_date: string;
  lineCount: number;
  assignmentLines: number;
  expectedPieces: number;
  goodPieces: number;
  damagedPieces: number;
  missingPieces: number;
  pendingPieces: number;
  incidentLines: number;
  goodsCostMxnCents: number;
  purchaseCount: number;
};

const OVERVIEW_COLUMNS =
  "id, shipment_number, carrier, tracking_number, shipping_cost_mxn_cents, estimated_arrival, status, notes, departed_at, first_received_at, received_at, cancelled_at, cancellation_reason, paid, paid_on, created_at, line_count, assignment_lines, expected_pieces, good_pieces, damaged_pieces, missing_pieces, pending_pieces, incident_lines, goods_cost_mxn_cents, purchase_count, cost_date";

/** A `date` column as "YYYY-MM-DD" (PostgREST sends text; be tolerant of a Date). */
function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function overviewRow(row: Record<string, unknown>): ShipmentListRow {
  return {
    id: row.id as string,
    shipment_number: row.shipment_number as string,
    carrier: row.carrier as string,
    tracking_number: (row.tracking_number as string | null) ?? null,
    shipping_cost_mxn_cents: num(row.shipping_cost_mxn_cents),
    estimated_arrival: dateOnly(row.estimated_arrival),
    status: row.status as ShipmentStatus,
    departed_at: (row.departed_at as string | null) ?? null,
    received_at: (row.received_at as string | null) ?? null,
    paid: Boolean(row.paid),
    paid_on: dateOnly(row.paid_on),
    created_at: row.created_at as string,
    cost_date: dateOnly(row.cost_date) ?? "",
    lineCount: num(row.line_count),
    assignmentLines: num(row.assignment_lines),
    expectedPieces: num(row.expected_pieces),
    goodPieces: num(row.good_pieces),
    damagedPieces: num(row.damaged_pieces),
    missingPieces: num(row.missing_pieces),
    pendingPieces: num(row.pending_pieces),
    incidentLines: num(row.incident_lines),
    goodsCostMxnCents: num(row.goods_cost_mxn_cents),
    purchaseCount: num(row.purchase_count),
  };
}

export type ListShipmentsResult = {
  shipments: ShipmentListRow[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
  state: ShipmentSchemaState;
};

export async function listShipments(query: { status?: string; page?: number } = {}): Promise<ListShipmentsResult> {
  const page = Math.max(1, query.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const empty = { shipments: [] as ShipmentListRow[], page, pageSize: PAGE_SIZE, total: 0, hasNextPage: false };

  let builder = adminDb().from("shipment_overview").select(OVERVIEW_COLUMNS, { count: "exact" }).eq("business_id", DEFAULT_BUSINESS_ID);
  if (query.status === "INCIDENTS") builder = builder.gt("incident_lines", 0);
  else if (query.status && SHIPMENT_STATUSES.includes(query.status as ShipmentStatus)) builder = builder.eq("status", query.status);
  const { data, error, count } = await builder.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error) {
    if (isMissingAnySchema(error.message)) return { ...empty, state: await missingShipmentState() };
    throw new Error(error.message);
  }
  const shipments = (data ?? []).map((row) => overviewRow(row as Record<string, unknown>));
  return { shipments, page, pageSize: PAGE_SIZE, total: count ?? shipments.length, hasNextPage: (count ?? 0) > from + PAGE_SIZE, state: "ready" };
}

export type CarrierAccount = {
  state: ShipmentSchemaState;
  from: string;
  to: string;
  /** Shipments that already left (IN_TRANSIT / PARTIALLY_RECEIVED / RECEIVED) in the period. */
  shippedCount: number;
  totalCents: number;
  paidCents: number;
  unpaidCents: number;
  pieces: number;
  /** Still DRAFT (cost planned, not spent yet). */
  draftCount: number;
  draftCents: number;
  byMonth: Array<{ month: string; count: number; totalCents: number; paidCents: number; unpaidCents: number }>;
  byCarrier: Array<{ carrier: string; count: number; totalCents: number; unpaidCents: number }>;
  unpaid: ShipmentListRow[];
};

/**
 * "Cuenta de paquetería": what was spent on shipping per shipment and per
 * period (Σ shipping cost of the shipments that left, by business-local
 * departure date), paid vs. not paid. Cancelled shipments never count.
 */
export async function getCarrierAccount(range: { from: string; to: string }): Promise<CarrierAccount> {
  const empty: CarrierAccount = {
    state: "ready",
    from: range.from,
    to: range.to,
    shippedCount: 0,
    totalCents: 0,
    paidCents: 0,
    unpaidCents: 0,
    pieces: 0,
    draftCount: 0,
    draftCents: 0,
    byMonth: [],
    byCarrier: [],
    unpaid: [],
  };
  const { data, error } = await adminDb()
    .from("shipment_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .neq("status", "CANCELLED")
    .gte("cost_date", range.from)
    .lte("cost_date", range.to)
    .order("cost_date", { ascending: false })
    .limit(2000);
  if (error) {
    if (isMissingAnySchema(error.message)) return { ...empty, state: await missingShipmentState() };
    throw new Error(error.message);
  }
  const rows = (data ?? []).map((row) => overviewRow(row as Record<string, unknown>));
  const account = { ...empty };
  const months = new Map<string, CarrierAccount["byMonth"][number]>();
  const carriers = new Map<string, CarrierAccount["byCarrier"][number]>();
  for (const row of rows) {
    if (row.status === "DRAFT") {
      account.draftCount += 1;
      account.draftCents += row.shipping_cost_mxn_cents;
      continue;
    }
    const cost = row.shipping_cost_mxn_cents;
    account.shippedCount += 1;
    account.totalCents += cost;
    account.pieces += row.expectedPieces;
    if (row.paid) account.paidCents += cost;
    else {
      account.unpaidCents += cost;
      account.unpaid.push(row);
    }
    const monthKey = row.cost_date.slice(0, 7);
    const month = months.get(monthKey) ?? { month: monthKey, count: 0, totalCents: 0, paidCents: 0, unpaidCents: 0 };
    month.count += 1;
    month.totalCents += cost;
    if (row.paid) month.paidCents += cost;
    else month.unpaidCents += cost;
    months.set(monthKey, month);
    const carrierKey = row.carrier.trim().toLowerCase();
    const carrier = carriers.get(carrierKey) ?? { carrier: row.carrier.trim(), count: 0, totalCents: 0, unpaidCents: 0 };
    carrier.count += 1;
    carrier.totalCents += cost;
    if (!row.paid) carrier.unpaidCents += cost;
    carriers.set(carrierKey, carrier);
  }
  account.byMonth = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  account.byCarrier = [...carriers.values()].sort((a, b) => b.totalCents - a.totalCents || a.carrier.localeCompare(b.carrier, "es"));
  return account;
}

export type ShipmentLineDetail = {
  id: string;
  position: number;
  purchase_id: string;
  purchase_item_id: string;
  assignment_id: string | null;
  kind: "ASSIGNMENT" | "FREE";
  expected: number;
  good: number;
  damaged: number;
  missing: number;
  pending: number;
  goodsCostMxnCents: number;
  shippingCostMxnCents: number;
  landedCostMxnCents: number;
  status: "ACTIVE" | "CANCELLED";
  product_id: string | null;
  variant_id: string | null;
  item: {
    name: string;
    variant_label: string | null;
    photoUrl: string | null;
    store_name: string;
    purchase_number: string;
    supplier_name: string;
  };
  assignment: {
    clientName: string;
    clientPhone: string | null;
    quantity: number;
    ticketId: string;
    ticketNumber: string | null;
    ticketLogisticsStatus: string | null;
    incidentReason: string | null;
    orderId: string;
  } | null;
};

export type ShipmentReceiptRow = {
  id: string;
  line_id: string;
  session_id: string;
  good: number;
  damaged: number;
  missing: number;
  notes: string | null;
  photos: Array<{ key: string; url: string | null }>;
  receivedBy: string | null;
  created_at: string;
};

export type ShipmentDetail = {
  shipment: ShipmentListRow & {
    notes: string | null;
    first_received_at: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
  };
  lines: ShipmentLineDetail[];
  receipts: ShipmentReceiptRow[];
};

type ItemInfoRow = {
  purchase_item_id: string;
  name: string;
  variant_label: string | null;
  photo_storage_key: string | null;
  store_name: string;
  purchase_number: string;
  supplier_name: string | null;
};

async function itemInfo(itemIds: string[]) {
  const map = new Map<string, ItemInfoRow>();
  if (!itemIds.length) return map;
  const { data, error } = await adminDb()
    .from("purchase_item_shipping")
    .select("purchase_item_id, name, variant_label, photo_storage_key, store_name, purchase_number, supplier_name")
    .in("purchase_item_id", itemIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) map.set(row.purchase_item_id as string, row as unknown as ItemInfoRow);
  return map;
}

/** Throws on unexpected errors; a missing migration throws with the message naming the file. */
export async function getShipmentDetail(id: string): Promise<ShipmentDetail | null> {
  if (!isUuid(id)) return null;
  const db = adminDb();
  const { data: row, error } = await db.from("shipment_overview").select(OVERVIEW_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    if (isMissingAnySchema(error.message)) throw new Error(shipmentUnavailableMessage(await missingShipmentState()) ?? error.message);
    throw new Error(error.message);
  }
  if (!row) return null;
  const raw = row as Record<string, unknown>;

  const [linesResult, receiptsResult] = await Promise.all([
    db
      .from("shipment_lines")
      .select(
        "id, position, purchase_id, purchase_item_id, assignment_id, expected_quantity, received_good_quantity, received_damaged_quantity, missing_quantity, goods_cost_mxn_cents, shipping_cost_mxn_cents, landed_cost_mxn_cents, status, product_id, variant_id",
      )
      .eq("shipment_id", id)
      .order("position", { ascending: true }),
    db
      .from("shipment_receipts")
      .select("id, shipment_line_id, session_id, good_quantity, damaged_quantity, missing_quantity, notes, photo_storage_keys, received_by_admin_id, created_at")
      .eq("shipment_id", id)
      .order("created_at", { ascending: true }),
  ]);
  for (const result of [linesResult, receiptsResult]) if (result.error) throw new Error(result.error.message);
  const lineRows = linesResult.data ?? [];
  const receiptRows = receiptsResult.data ?? [];

  const assignmentIds = lineRows.map((line) => line.assignment_id as string | null).filter((value): value is string => Boolean(value));
  const actorIds = [...new Set(receiptRows.map((receipt) => receipt.received_by_admin_id as string | null).filter((value): value is string => Boolean(value)))];
  const photoKeys = receiptRows.flatMap((receipt) => (receipt.photo_storage_keys as string[] | null) ?? []);

  const [items, assignmentsResult, actorsResult, signed] = await Promise.all([
    itemInfo([...new Set(lineRows.map((line) => line.purchase_item_id as string))]),
    assignmentIds.length
      ? db
          .from("purchase_assignments")
          .select(
            "id, quantity, order_id, ticket_id, clients(first_name, last_name, phone), tickets(ticket_number, logistics_status, incident_reason)",
          )
          .in("id", assignmentIds)
      : Promise.resolve({ data: [], error: null }),
    actorIds.length ? db.from("admin_users").select("id, display_name").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
    signedReceiptUrls(photoKeys),
  ]);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  const assignments = new Map<string, ShipmentLineDetail["assignment"]>();
  for (const assignment of (assignmentsResult.data ?? []) as Array<Record<string, unknown>>) {
    const client = relation(assignment.clients as unknown as ClientRef[]);
    const ticket = relation(assignment.tickets as unknown as TicketRef[]);
    assignments.set(assignment.id as string, {
      clientName: clientName(client),
      clientPhone: client?.phone ?? null,
      quantity: num(assignment.quantity),
      ticketId: assignment.ticket_id as string,
      ticketNumber: ticket?.ticket_number ?? null,
      ticketLogisticsStatus: ticket?.logistics_status ?? null,
      incidentReason: ticket?.incident_reason ?? null,
      orderId: assignment.order_id as string,
    });
  }
  const actors = new Map(((actorsResult.data ?? []) as Array<Record<string, unknown>>).map((actor) => [actor.id as string, actor.display_name as string]));

  const lines: ShipmentLineDetail[] = lineRows.map((line) => {
    const info = items.get(line.purchase_item_id as string);
    const expected = num(line.expected_quantity);
    const good = num(line.received_good_quantity);
    const damaged = num(line.received_damaged_quantity);
    const missing = num(line.missing_quantity);
    const assignmentId = (line.assignment_id as string | null) ?? null;
    return {
      id: line.id as string,
      position: num(line.position),
      purchase_id: line.purchase_id as string,
      purchase_item_id: line.purchase_item_id as string,
      assignment_id: assignmentId,
      kind: assignmentId ? "ASSIGNMENT" : "FREE",
      expected,
      good,
      damaged,
      missing,
      pending: expected - good - damaged - missing,
      goodsCostMxnCents: num(line.goods_cost_mxn_cents),
      shippingCostMxnCents: num(line.shipping_cost_mxn_cents),
      landedCostMxnCents: num(line.landed_cost_mxn_cents),
      status: line.status as "ACTIVE" | "CANCELLED",
      product_id: (line.product_id as string | null) ?? null,
      variant_id: (line.variant_id as string | null) ?? null,
      item: {
        name: info?.name ?? "Artículo",
        variant_label: info?.variant_label ?? null,
        photoUrl: itemPhotoUrl(info?.photo_storage_key ?? null),
        store_name: info?.store_name ?? "",
        purchase_number: info?.purchase_number ?? "",
        supplier_name: info?.supplier_name ?? "Shopper eliminado",
      },
      assignment: assignmentId ? (assignments.get(assignmentId) ?? null) : null,
    };
  });

  const receipts: ShipmentReceiptRow[] = receiptRows.map((receipt) => ({
    id: receipt.id as string,
    line_id: receipt.shipment_line_id as string,
    session_id: receipt.session_id as string,
    good: num(receipt.good_quantity),
    damaged: num(receipt.damaged_quantity),
    missing: num(receipt.missing_quantity),
    notes: (receipt.notes as string | null) ?? null,
    photos: ((receipt.photo_storage_keys as string[] | null) ?? []).map((key) => ({ key, url: signed.get(key) ?? null })),
    receivedBy: receipt.received_by_admin_id ? (actors.get(receipt.received_by_admin_id as string) ?? "Usuario eliminado") : null,
    created_at: receipt.created_at as string,
  }));

  return {
    shipment: {
      ...overviewRow(raw),
      notes: (raw.notes as string | null) ?? null,
      first_received_at: (raw.first_received_at as string | null) ?? null,
      cancelled_at: (raw.cancelled_at as string | null) ?? null,
      cancellation_reason: (raw.cancellation_reason as string | null) ?? null,
    },
    lines,
    receipts,
  };
}

export type CandidateAssignment = {
  assignmentId: string;
  clientName: string;
  quantity: number;
  costMxnCents: number;
  ticketNumber: string | null;
  ticketLogisticsStatus: string | null;
  /** Ticket ORDERED / IN_TRANSIT: it can travel. */
  shippable: boolean;
};

export type CandidateItem = {
  id: string;
  purchase_id: string;
  purchase_number: string;
  purchase_date: string;
  supplierName: string;
  store_name: string;
  name: string;
  variant_label: string | null;
  photoUrl: string | null;
  purchased: number;
  assigned: number;
  freeShipped: number;
  assignedShipped: number;
  /** Free units not in any non-cancelled shipment. */
  freeUnshipped: number;
  unitCostMxnCents: number | null;
  lineCostMxnCents: number | null;
  assignments: CandidateAssignment[];
};

export type CandidatesResult = { state: ShipmentSchemaState; items: CandidateItem[]; truncated: boolean };

const CANDIDATE_LIMIT = 150;

/**
 * What can still travel (the base of /admin/compras/pendientes): every PURCHASED
 * line of a CONFIRMED purchase that has free units or ACTIVE assignments not yet
 * in a non-cancelled shipment, with those assignments.
 */
export async function listShippingCandidates(query: { search?: string; supplierId?: string; purchaseId?: string } = {}): Promise<CandidatesResult> {
  const db = adminDb();
  let builder = db
    .from("purchase_item_shipping")
    .select(
      "purchase_item_id, purchase_id, purchase_number, purchase_date, supplier_name, store_name, name, variant_label, photo_storage_key, purchased_quantity, assigned_quantity, free_shipped_quantity, assigned_shipped_quantity, free_unshipped_quantity, unit_cost_mxn_cents, line_cost_mxn_cents",
    )
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .eq("purchase_status", "CONFIRMED")
    .eq("item_status", "PURCHASED")
    .eq("has_unshipped", true);
  const term = text(query.search).replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  if (term) builder = builder.ilike("name", `%${term}%`);
  if (query.supplierId && isUuid(query.supplierId)) builder = builder.eq("supplier_id", query.supplierId);
  if (query.purchaseId && isUuid(query.purchaseId)) builder = builder.eq("purchase_id", query.purchaseId);
  const { data, error } = await builder
    .order("purchase_date", { ascending: false })
    .order("purchase_number", { ascending: false })
    .order("item_created_at", { ascending: true })
    .limit(CANDIDATE_LIMIT + 1);
  if (error) {
    if (isMissingAnySchema(error.message)) return { state: await missingShipmentState(), items: [], truncated: false };
    throw new Error(error.message);
  }
  const rows = (data ?? []).slice(0, CANDIDATE_LIMIT);
  const ids = rows.map((row) => row.purchase_item_id as string);

  const byItem = new Map<string, CandidateAssignment[]>();
  if (ids.length) {
    const { data: assignmentRows, error: assignmentError } = await db
      .from("purchase_assignments")
      .select("id, purchase_item_id, quantity, cost_mxn_cents, ticket_id, created_at, clients(first_name, last_name), tickets(ticket_number, logistics_status)")
      .in("purchase_item_id", ids)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: true });
    if (assignmentError) throw new Error(assignmentError.message);
    const assignmentIds = (assignmentRows ?? []).map((row) => row.id as string);
    const shipped = new Set<string>();
    if (assignmentIds.length) {
      const { data: lineRows, error: lineError } = await db
        .from("shipment_lines")
        .select("assignment_id")
        .in("assignment_id", assignmentIds)
        .eq("status", "ACTIVE");
      if (lineError) throw new Error(lineError.message);
      for (const line of lineRows ?? []) shipped.add(line.assignment_id as string);
    }
    for (const row of assignmentRows ?? []) {
      if (shipped.has(row.id as string)) continue;
      const ticket = relation(row.tickets as unknown as TicketRef[]);
      const list = byItem.get(row.purchase_item_id as string) ?? [];
      list.push({
        assignmentId: row.id as string,
        clientName: clientName(relation(row.clients as unknown as ClientRef[])),
        quantity: num(row.quantity),
        costMxnCents: num(row.cost_mxn_cents),
        ticketNumber: ticket?.ticket_number ?? null,
        ticketLogisticsStatus: ticket?.logistics_status ?? null,
        shippable: ticket ? ["ORDERED", "IN_TRANSIT"].includes(ticket.logistics_status) : false,
      });
      byItem.set(row.purchase_item_id as string, list);
    }
  }

  const items: CandidateItem[] = rows.map((row) => ({
    id: row.purchase_item_id as string,
    purchase_id: row.purchase_id as string,
    purchase_number: row.purchase_number as string,
    purchase_date: row.purchase_date as string,
    supplierName: (row.supplier_name as string | null) ?? "Shopper eliminado",
    store_name: row.store_name as string,
    name: row.name as string,
    variant_label: (row.variant_label as string | null) ?? null,
    photoUrl: itemPhotoUrl((row.photo_storage_key as string | null) ?? null),
    purchased: num(row.purchased_quantity),
    assigned: num(row.assigned_quantity),
    freeShipped: num(row.free_shipped_quantity),
    assignedShipped: num(row.assigned_shipped_quantity),
    freeUnshipped: Math.max(0, num(row.free_unshipped_quantity)),
    unitCostMxnCents: row.unit_cost_mxn_cents === null || row.unit_cost_mxn_cents === undefined ? null : num(row.unit_cost_mxn_cents),
    lineCostMxnCents: row.line_cost_mxn_cents === null || row.line_cost_mxn_cents === undefined ? null : num(row.line_cost_mxn_cents),
    assignments: byItem.get(row.purchase_item_id as string) ?? [],
  }));
  return { state: "ready", items, truncated: (data ?? []).length > CANDIDATE_LIMIT };
}

export type DraftShipmentOption = { id: string; shipment_number: string; carrier: string; lineCount: number };

export async function listDraftShipments(): Promise<DraftShipmentOption[]> {
  const { data, error } = await adminDb()
    .from("shipment_overview")
    .select("id, shipment_number, carrier, line_count, created_at")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .eq("status", "DRAFT")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id as string,
    shipment_number: row.shipment_number as string,
    carrier: row.carrier as string,
    lineCount: num(row.line_count),
  }));
}

/** Carriers already used, most recent first, for the form's suggestions. */
export async function listCarrierSuggestions(limit = 200): Promise<string[]> {
  const { data, error } = await adminDb()
    .from("shipments")
    .select("carrier, created_at")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  const seen = new Map<string, string>();
  for (const row of data ?? []) {
    const name = text(row.carrier);
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
}

export type ItemShippingInfo = {
  freeShipped: number;
  assignedShipped: number;
  freeUnshipped: number;
  unshippedAssignments: number;
};

/**
 * Shipping counts per purchased line, for the Compras screens. Empty when 014
 * is not applied: those screens must keep working exactly as before without it.
 */
export async function getItemShippingInfo(itemIds: string[]): Promise<Map<string, ItemShippingInfo>> {
  const map = new Map<string, ItemShippingInfo>();
  if (!itemIds.length) return map;
  try {
    const { data, error } = await adminDb()
      .from("purchase_item_shipping")
      .select("purchase_item_id, free_shipped_quantity, assigned_shipped_quantity, free_unshipped_quantity, unshipped_assignments")
      .in("purchase_item_id", itemIds);
    if (error) return map;
    for (const row of data ?? []) {
      map.set(row.purchase_item_id as string, {
        freeShipped: num(row.free_shipped_quantity),
        assignedShipped: num(row.assigned_shipped_quantity),
        freeUnshipped: Math.max(0, num(row.free_unshipped_quantity)),
        unshippedAssignments: num(row.unshipped_assignments),
      });
    }
  } catch {
    // Informational only.
  }
  return map;
}

export type ReceptionIncidentTicket = { id: string; ticket_number: string; product_name: string; incident_reason: string };

/**
 * Tickets left in "Recibido en La Paz" by a reception with damaged/missing
 * units (incident_reason written by receive_shipment). Reads only `tickets`, so
 * it works (empty) before 014.
 */
export async function listReceptionIncidentTickets(limit = 50): Promise<ReceptionIncidentTicket[]> {
  try {
    const { data, error } = await adminDb()
      .from("tickets")
      .select("id, ticket_number, product_name_snapshot, incident_reason, logistics_status, updated_at")
      .eq("logistics_status", "RECEIVED_LA_PAZ")
      .like("incident_reason", "Recepción EMB-%")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: row.id as string,
      ticket_number: row.ticket_number as string,
      product_name: row.product_name_snapshot as string,
      incident_reason: row.incident_reason as string,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Photos (reception evidence: private bucket, signed URLs only)
// ---------------------------------------------------------------------------

export function validateShipmentPhoto(file: File | null | undefined): string | null {
  if (!file || file.size === 0) return null;
  if (!PHOTO_EXTENSIONS[file.type]) return "La foto debe ser JPG, PNG o WEBP.";
  if (file.size > MAX_SHIPMENT_PHOTO_BYTES) return "La foto debe pesar 5 MB o menos.";
  return null;
}

export async function uploadShipmentPhoto(shipmentId: string, file: File): Promise<Result<{ key: string }>> {
  const invalid = validateShipmentPhoto(file);
  if (invalid) return fail(invalid);
  if (!isUuid(shipmentId)) return fail("Embarque no encontrado.");
  const key = `shipment-receipts/${shipmentId}/${crypto.randomUUID()}.${PHOTO_EXTENSIONS[file.type]}`;
  const { error } = await adminStorage().from(EXPENSE_RECEIPT_BUCKET).upload(key, file, { contentType: file.type, upsert: false });
  if (error) return fail(`No fue posible subir la foto (${error.message}).`);
  return { ok: true, key };
}

export async function removeShipmentPhotos(keys: string[]) {
  if (!keys.length) return;
  try {
    await adminStorage().from(EXPENSE_RECEIPT_BUCKET).remove(keys);
  } catch {
    // An orphaned file is harmless.
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type ShipmentHeaderInput = {
  carrier: unknown;
  trackingNumber?: unknown;
  shippingCost?: unknown;
  estimatedArrival?: unknown;
  notes?: unknown;
};

function parseHeader(input: ShipmentHeaderInput): Result<{ header: Record<string, string> ; costCents: number }> {
  const carrier = text(input.carrier).replace(/\s+/g, " ");
  if (!carrier) return fail("Escribe la paquetería (o un nombre para el embarque).");
  if (carrier.length > 80) return fail("La paquetería no puede exceder 80 caracteres.");
  const tracking = text(input.trackingNumber);
  if (tracking.length > 120) return fail("La guía no puede exceder 120 caracteres.");
  const cost = parseShippingCostToCents(input.shippingCost);
  if (!cost.ok) return cost;
  const eta = text(input.estimatedArrival);
  if (eta && !isIsoDate(eta)) return fail("La llegada estimada no es una fecha válida.");
  const notes = text(input.notes);
  if (notes.length > 1000) return fail("Las notas no pueden exceder 1000 caracteres.");
  return {
    ok: true,
    costCents: cost.value,
    header: {
      carrier,
      tracking_number: tracking,
      shipping_cost_mxn_cents: String(cost.value),
      estimated_arrival: eta,
      notes,
    },
  };
}

export type ShipmentLineInput = { assignmentId: string } | { purchaseItemId: string; quantity: unknown };

function parseLines(lines: ShipmentLineInput[]): Result<{ payload: Array<Record<string, unknown>> }> {
  if (!lines.length) return fail("Elige al menos un artículo para el embarque.");
  if (lines.length > 500) return fail("Son demasiadas líneas para un solo paso (máximo 500).");
  const payload: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if ("assignmentId" in line) {
      const id = text(line.assignmentId);
      if (!isUuid(id)) return fail("Asignación no encontrada.");
      if (seen.has(`a:${id}`)) continue;
      seen.add(`a:${id}`);
      payload.push({ assignment_id: id });
    } else {
      const id = text(line.purchaseItemId);
      if (!isUuid(id)) return fail("Artículo no encontrado.");
      const quantity = text(line.quantity);
      if (!quantity || quantity === "0") continue;
      if (!/^\d+$/.test(quantity)) return fail("Las piezas libres deben ser un número entero (1, 2, 3…).");
      if (seen.has(`i:${id}`)) return fail("Un artículo viene dos veces como piezas libres.");
      seen.add(`i:${id}`);
      payload.push({ purchase_item_id: id, quantity: Number(quantity) });
    }
  }
  if (!payload.length) return fail("Elige al menos un artículo para el embarque.");
  return { ok: true, payload };
}

export async function createShipment(input: ShipmentHeaderInput & { actorId: string; lines: ShipmentLineInput[] }): Promise<
  Result<{ id: string; shipmentNumber: string; linesAdded: number }>
> {
  const header = parseHeader(input);
  if (!header.ok) return header;
  const lines = parseLines(input.lines);
  if (!lines.ok) return lines;
  const { data, error } = await adminDb().rpc("create_shipment", {
    p_actor_id: input.actorId,
    p_header: header.header,
    p_lines: lines.payload,
  });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible crear el embarque."));
  const row = (data ?? {}) as Record<string, unknown>;
  const id = String(row.shipment_id ?? "");
  const shipmentNumber = String(row.shipment_number ?? "");
  await logActivity({
    adminUserId: input.actorId,
    action: "SHIPMENT_CREATED",
    entityType: "shipments",
    entityId: id,
    newData: { shipmentNumber, ...header.header, lines: lines.payload },
  });
  return { ok: true, id, shipmentNumber, linesAdded: num(row.lines_added) };
}

export async function addShipmentLines(input: { actorId: string; shipmentId: string; lines: ShipmentLineInput[] }): Promise<
  Result<{ shipmentNumber: string; linesAdded: number }>
> {
  if (!isUuid(input.shipmentId)) return fail("Embarque no encontrado.");
  const lines = parseLines(input.lines);
  if (!lines.ok) return lines;
  const { data, error } = await adminDb().rpc("add_shipment_lines", {
    p_shipment_id: input.shipmentId,
    p_actor_id: input.actorId,
    p_lines: lines.payload,
  });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible agregar al embarque."));
  const row = (data ?? {}) as Record<string, unknown>;
  await logActivity({
    adminUserId: input.actorId,
    action: "SHIPMENT_LINES_ADDED",
    entityType: "shipments",
    entityId: input.shipmentId,
    newData: { shipmentNumber: row.shipment_number ?? null, lines: lines.payload },
  });
  return { ok: true, shipmentNumber: String(row.shipment_number ?? ""), linesAdded: num(row.lines_added) };
}

export async function removeShipmentLine(input: { actorId: string; lineId: string }): Promise<Result<{ shipmentId: string }>> {
  if (!isUuid(text(input.lineId))) return fail("Línea no encontrada.");
  const { data, error } = await adminDb().rpc("remove_shipment_line", { p_line_id: input.lineId, p_actor_id: input.actorId });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible quitar la línea."));
  const row = (data ?? {}) as Record<string, unknown>;
  await logActivity({
    adminUserId: input.actorId,
    action: "SHIPMENT_LINE_REMOVED",
    entityType: "shipments",
    entityId: String(row.shipment_id ?? ""),
    previousData: { lineId: input.lineId, purchaseItemId: row.purchase_item_id ?? null, assignmentId: row.assignment_id ?? null, quantity: row.quantity ?? null },
  });
  return { ok: true, shipmentId: String(row.shipment_id ?? "") };
}

export async function updateShipmentHeader(input: ShipmentHeaderInput & { actorId: string; shipmentId: string }): Promise<Result> {
  if (!isUuid(input.shipmentId)) return fail("Embarque no encontrado.");
  const header = parseHeader(input);
  if (!header.ok) return header;
  const { data, error } = await adminDb().rpc("update_shipment_header", {
    p_shipment_id: input.shipmentId,
    p_actor_id: input.actorId,
    p_header: header.header,
  });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible guardar el embarque."));
  const row = (data ?? {}) as Record<string, unknown>;
  await logActivity({
    adminUserId: input.actorId,
    action: "SHIPMENT_UPDATED",
    entityType: "shipments",
    entityId: input.shipmentId,
    previousData: { shipping_cost_mxn_cents: row.previous_cost ?? null },
    newData: header.header,
  });
  return { ok: true };
}

export async function setShipmentPaid(input: { actorId: string; shipmentId: string; paid: boolean; paidOn?: unknown }): Promise<Result> {
  if (!isUuid(input.shipmentId)) return fail("Embarque no encontrado.");
  const paidOn = text(input.paidOn);
  if (input.paid && !isIsoDate(paidOn)) return fail("Indica la fecha en que pagaste el envío.");
  const { error } = await adminDb().rpc("set_shipment_paid", {
    p_shipment_id: input.shipmentId,
    p_actor_id: input.actorId,
    p_paid: input.paid,
    p_paid_on: input.paid ? paidOn : null,
  });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible guardar el pago del envío."));
  await logActivity({
    adminUserId: input.actorId,
    action: input.paid ? "SHIPMENT_PAID" : "SHIPMENT_UNPAID",
    entityType: "shipments",
    entityId: input.shipmentId,
    newData: { paid: input.paid, paid_on: input.paid ? paidOn : null },
  });
  return { ok: true };
}

type MovedTicket = { ticket_id: string; ticket_number: string; client_id: string; product_name: string; to: string | null };

function notices(tickets: unknown): TicketLogisticsNotice[] {
  return ((Array.isArray(tickets) ? tickets : []) as MovedTicket[])
    .filter((ticket) => ticket.to)
    .map((ticket) => ({
      ticketId: ticket.ticket_id,
      clientId: ticket.client_id,
      ticketNumber: ticket.ticket_number,
      productName: ticket.product_name,
      status: ticket.to as string,
    }));
}

/** "Confirmar salida": the shipment goes IN_TRANSIT and its tickets ORDERED -> IN_TRANSIT (clients notified). */
export async function confirmShipmentDeparture(input: { actorId: string; shipmentId: string }): Promise<
  Result<{ shipmentNumber: string; ticketsMoved: number; pieces: number }>
> {
  if (!isUuid(input.shipmentId)) return fail("Embarque no encontrado.");
  const { data, error } = await adminDb().rpc("confirm_shipment_departure", { p_shipment_id: input.shipmentId, p_actor_id: input.actorId });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible confirmar la salida."));
  const row = (data ?? {}) as Record<string, unknown>;
  const moved = notices(row.tickets);
  await notifyTicketsLogistics(moved);
  await logActivity({
    adminUserId: input.actorId,
    action: "SHIPMENT_DEPARTED",
    entityType: "shipments",
    entityId: input.shipmentId,
    newData: {
      shipmentNumber: row.shipment_number ?? null,
      lines: row.lines ?? null,
      pieces: row.pieces ?? null,
      tickets: moved.map((ticket) => ticket.ticketNumber),
    },
  });
  return { ok: true, shipmentNumber: String(row.shipment_number ?? ""), ticketsMoved: moved.length, pieces: num(row.pieces) };
}

export async function cancelShipment(input: { actorId: string; shipmentId: string; reason: unknown }): Promise<Result<{ shipmentNumber: string }>> {
  if (!isUuid(input.shipmentId)) return fail("Embarque no encontrado.");
  const reason = text(input.reason).slice(0, 500);
  if (!reason) return fail("Escribe el motivo para cancelar el embarque.");
  const { data, error } = await adminDb().rpc("cancel_shipment", { p_shipment_id: input.shipmentId, p_actor_id: input.actorId, p_reason: reason });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible cancelar el embarque."));
  const row = (data ?? {}) as Record<string, unknown>;
  await logActivity({ adminUserId: input.actorId, action: "SHIPMENT_CANCELLED", entityType: "shipments", entityId: input.shipmentId, newData: { reason } });
  return { ok: true, shipmentNumber: String(row.shipment_number ?? "") };
}

export type ReceptionLineInput = {
  lineId: string;
  good?: unknown;
  damaged?: unknown;
  missing?: unknown;
  notes?: unknown;
  /** Keys already uploaded with uploadShipmentPhoto(). */
  photoKeys?: string[];
};

export type ReceptionResult = {
  shipmentNumber: string;
  status: ShipmentStatus;
  pendingLines: number;
  good: number;
  damaged: number;
  missing: number;
  readyTickets: string[];
  incidentTickets: string[];
  products: Array<{ productId: string; name: string; quantity: number; created: boolean }>;
};

/**
 * "Recibir en La Paz". Built to be shared with the employee panel: it takes the
 * actor explicitly and does not check the OWNER role (the SQL function only
 * requires an ACTIVE admin_users row). Photos must be uploaded first with
 * uploadShipmentPhoto() and passed as keys; if the reception fails the caller
 * should remove them (removeShipmentPhotos).
 */
export async function receiveShipment(input: { actorId: string; shipmentId: string; lines: ReceptionLineInput[] }): Promise<
  Result<ReceptionResult>
> {
  if (!isUuid(input.shipmentId)) return fail("Embarque no encontrado.");
  if (!input.lines.length) return fail("Captura al menos una línea de la recepción.");
  const payload: Array<Record<string, unknown>> = [];
  for (const line of input.lines) {
    if (!isUuid(text(line.lineId))) return fail("Línea de embarque no válida.");
    const good = parseReceivedCount(line.good, "En buen estado");
    if (!good.ok) return good;
    const damaged = parseReceivedCount(line.damaged, "Dañadas");
    if (!damaged.ok) return damaged;
    const missing = parseReceivedCount(line.missing, "Faltantes");
    if (!missing.ok) return missing;
    const notes = text(line.notes);
    if (notes.length > 1000) return fail("Las observaciones no pueden exceder 1000 caracteres.");
    const photoKeys = (line.photoKeys ?? []).filter(Boolean);
    if (photoKeys.length > 6) return fail("Máximo 6 fotos por línea en cada recepción.");
    if (good.value + damaged.value + missing.value === 0 && !notes && !photoKeys.length) {
      return fail("Captura cuántas llegaron (buenas, dañadas o faltantes), una observación o una foto.");
    }
    payload.push({ line_id: line.lineId, good: good.value, damaged: damaged.value, missing: missing.value, notes, photo_keys: photoKeys });
  }

  const { data, error } = await adminDb().rpc("receive_shipment", {
    p_shipment_id: input.shipmentId,
    p_actor_id: input.actorId,
    p_lines: payload,
  });
  if (error) return fail(await describeShipmentError(new Error(error.message), "No fue posible registrar la recepción."));
  const row = (data ?? {}) as Record<string, unknown>;
  const tickets = (Array.isArray(row.tickets) ? row.tickets : []) as Array<MovedTicket & { incident?: boolean }>;
  await notifyTicketsLogistics(notices(tickets));
  const products = ((Array.isArray(row.products) ? row.products : []) as Array<Record<string, unknown>>).map((product) => ({
    productId: String(product.product_id ?? ""),
    name: String(product.name ?? ""),
    quantity: num(product.quantity),
    created: Boolean(product.created),
  }));
  const result: ReceptionResult = {
    shipmentNumber: String(row.shipment_number ?? ""),
    status: (row.status as ShipmentStatus) ?? "PARTIALLY_RECEIVED",
    pendingLines: num(row.pending_lines),
    good: num(row.good),
    damaged: num(row.damaged),
    missing: num(row.missing),
    readyTickets: tickets.filter((ticket) => ticket.to === "READY_FOR_DELIVERY").map((ticket) => ticket.ticket_number),
    incidentTickets: tickets.filter((ticket) => ticket.incident).map((ticket) => ticket.ticket_number),
    products,
  };
  await logActivity({
    adminUserId: input.actorId,
    action: "SHIPMENT_RECEIVED",
    entityType: "shipments",
    entityId: input.shipmentId,
    newData: {
      shipmentNumber: result.shipmentNumber,
      sessionId: row.session_id ?? null,
      status: result.status,
      good: result.good,
      damaged: result.damaged,
      missing: result.missing,
      lines: payload.map((line) => ({ ...line, photo_keys: (line.photo_keys as string[]).length })),
      readyTickets: result.readyTickets,
      incidentTickets: result.incidentTickets,
      products: products.map((product) => ({ productId: product.productId, quantity: product.quantity, created: product.created })),
    },
  });
  return { ok: true, ...result };
}
