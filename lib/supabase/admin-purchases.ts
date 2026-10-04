import { describeError } from "../actions";
import { businessToday, parseMoneyToCents } from "../format";
import {
  DEFAULT_BUSINESS_ID,
  EXPENSE_RECEIPT_BUCKET,
  PRODUCT_IMAGE_BUCKET,
  adminDb,
  adminStorage,
  logActivity,
} from "./business";
import {
  MAX_ITEM_QUANTITY,
  MAX_USD_CENTS,
  PURCHASE_MIGRATION_FILE,
  computeOwed,
  computePurchaseConfirmation,
  parseCommission,
  parseExchangeRate,
  parseUsdToCents,
  storeKey,
  summarizePurchase,
  summarizeStores,
  summarizeTicket,
  type ConfirmationSnapshot,
  type PurchaseSummary,
  type StoreSummary,
  type TicketSummary,
} from "./purchase-math";

// ---------------------------------------------------------------------------
// Compras con shopper (phase 1): purchases / purchase_tickets / purchase_items /
// shopper_payments, added by database/migrations/010_shopper_purchases.sql. The
// shopper is a `suppliers` row. Every function here takes the acting admin's id
// explicitly (no session), so the whole flow can be exercised from a script;
// the server actions in app/admin/compras/actions.ts only check the session,
// read the form and delegate. Money rules live in ./purchase-math.ts.
//
// Until migration 010 is applied every read reports `unavailable` and every
// write answers with a message naming the file, instead of throwing.
// ---------------------------------------------------------------------------

export type PurchaseStatus = "OPEN" | "CONFIRMED" | "CANCELLED";
export type PurchaseItemStatus = "CAPTURED" | "PURCHASED";
export type ShopperPaymentMethod = "CASH" | "TRANSFER" | "OTHER";

export const PURCHASE_STATUSES: PurchaseStatus[] = ["OPEN", "CONFIRMED", "CANCELLED"];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  OPEN: "Capturando",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
};

export const PURCHASE_STATUS_TONES: Record<PurchaseStatus, "neutral" | "rose" | "success" | "warning" | "danger"> = {
  OPEN: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
};

export const PURCHASE_ITEM_STATUS_LABELS: Record<PurchaseItemStatus, string> = {
  CAPTURED: "Capturado",
  PURCHASED: "Comprado, pendiente de envío",
};

export const SHOPPER_PAYMENT_METHODS: ShopperPaymentMethod[] = ["TRANSFER", "CASH", "OTHER"];

export const SHOPPER_PAYMENT_METHOD_LABELS: Record<ShopperPaymentMethod, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  OTHER: "Otro",
};

export const PURCHASES_UNAVAILABLE_MESSAGE = `Falta aplicar ${PURCHASE_MIGRATION_FILE} en el editor SQL de Supabase.`;

/** Item and ticket photos are compressed in the browser; this is the panel's usual cap. */
export const MAX_PURCHASE_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Ticket photos are private documents: every view is a signed URL that expires. */
const SIGNED_URL_SECONDS = 300;

const PAGE_SIZE = 20;
const MAX_PAYMENT_MXN_CENTS = 100_000_000_00;

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function isMissingPurchaseSchema(message: string | null | undefined) {
  if (!message) return false;
  const names = ["purchases", "purchase_tickets", "purchase_items", "shopper_payments", "confirm_shopper_purchase"];
  if (!names.some((name) => message.includes(name))) return false;
  return message.includes("does not exist") || message.includes("schema cache") || message.includes("Could not find the");
}

/** lib/actions.ts#describeError points missing tables at migration 002; this module needs 010. */
export function describePurchaseError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (isMissingPurchaseSchema(message)) return PURCHASES_UNAVAILABLE_MESSAGE;
  return describeError(error instanceof Error ? error : new Error(message || fallback), fallback);
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const num = (value: unknown) => Number(value ?? 0);
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => String(value ?? "").trim();

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseDate(raw: unknown, label: string): Result<{ value: string }> {
  const value = text(raw);
  if (!isIsoDate(value)) return fail(`Elige la fecha ${label}.`);
  if (value > businessToday()) return fail(`La fecha ${label} no puede ser futura.`);
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type SupplierRef = { id: string; name: string; company: string | null; is_active?: boolean };

export type PurchaseListRow = {
  id: string;
  purchase_number: string;
  purchase_date: string;
  status: PurchaseStatus;
  supplier: SupplierRef | null;
  exchange_rate: number;
  commission_percent: number;
  ticketCount: number;
  pieces: number;
  capturedWithTaxUsdCents: number;
  /** Frozen amount owed (CONFIRMED only). */
  owedMxnCents: number | null;
  /** While OPEN: what it would cost today with the real totals typed so far. */
  estimatedOwedMxnCents: number | null;
  paidMxnCents: number;
  balanceMxnCents: number | null;
};

export type ListPurchasesResult = {
  purchases: PurchaseListRow[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
  unavailable: boolean;
};

type TicketRowLite = { id: string; purchase_id: string; tax_usd_cents: number; real_total_usd_cents: number | null };
type ItemRowLite = { ticket_id: string; purchase_id: string; quantity: number; unit_price_usd_cents: number };

function estimateOwed(rate: number, commission: number, summary: PurchaseSummary) {
  try {
    return computeOwed(summary.bestTotalUsdCents, commission, rate).owedMxnCents;
  } catch {
    return null;
  }
}

export async function listPurchases(query: { status?: string; supplierId?: string; page?: number } = {}): Promise<ListPurchasesResult> {
  const page = Math.max(1, query.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const empty = { purchases: [] as PurchaseListRow[], page, pageSize: PAGE_SIZE, total: 0, hasNextPage: false };
  const db = adminDb();

  let builder = db
    .from("purchases")
    .select(
      "id, purchase_number, purchase_date, status, exchange_rate, commission_percent, owed_mxn_cents, created_at, supplier_id, suppliers(id, name, company)",
      { count: "exact" },
    )
    .eq("business_id", DEFAULT_BUSINESS_ID);
  if (query.status && PURCHASE_STATUSES.includes(query.status as PurchaseStatus)) builder = builder.eq("status", query.status);
  if (query.supplierId) builder = builder.eq("supplier_id", query.supplierId);

  const { data, error, count } = await builder
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) {
    if (isMissingPurchaseSchema(error.message)) return { ...empty, unavailable: true };
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const ids = rows.map((row) => row.id as string);
  let tickets: TicketRowLite[] = [];
  let items: ItemRowLite[] = [];
  const paid = new Map<string, number>();
  if (ids.length) {
    const [ticketsResult, itemsResult, paymentsResult] = await Promise.all([
      db.from("purchase_tickets").select("id, purchase_id, tax_usd_cents, real_total_usd_cents").in("purchase_id", ids),
      db.from("purchase_items").select("ticket_id, purchase_id, quantity, unit_price_usd_cents").in("purchase_id", ids),
      db.from("shopper_payments").select("purchase_id, amount_mxn_cents, voided_at").in("purchase_id", ids),
    ]);
    for (const result of [ticketsResult, itemsResult, paymentsResult]) if (result.error) throw new Error(result.error.message);
    tickets = (ticketsResult.data ?? []) as TicketRowLite[];
    items = (itemsResult.data ?? []) as ItemRowLite[];
    for (const payment of paymentsResult.data ?? []) {
      if (payment.voided_at) continue;
      const key = payment.purchase_id as string;
      paid.set(key, (paid.get(key) ?? 0) + num(payment.amount_mxn_cents));
    }
  }

  const purchases: PurchaseListRow[] = rows.map((row) => {
    const id = row.id as string;
    const summaries = tickets
      .filter((ticket) => ticket.purchase_id === id)
      .map((ticket) =>
        summarizeTicket({
          taxUsdCents: num(ticket.tax_usd_cents),
          realTotalUsdCents: numOrNull(ticket.real_total_usd_cents),
          items: items
            .filter((item) => item.ticket_id === ticket.id)
            .map((item) => ({ quantity: num(item.quantity), unitPriceUsdCents: num(item.unit_price_usd_cents) })),
        }),
      );
    const summary = summarizePurchase(summaries);
    const status = row.status as PurchaseStatus;
    const owed = status === "CONFIRMED" ? numOrNull(row.owed_mxn_cents) : null;
    const paidCents = paid.get(id) ?? 0;
    return {
      id,
      purchase_number: row.purchase_number as string,
      purchase_date: row.purchase_date as string,
      status,
      supplier: relation(row.suppliers as unknown as SupplierRef[]),
      exchange_rate: num(row.exchange_rate),
      commission_percent: num(row.commission_percent),
      ticketCount: summary.ticketCount,
      pieces: summary.pieces,
      capturedWithTaxUsdCents: summary.capturedWithTaxUsdCents,
      owedMxnCents: owed,
      estimatedOwedMxnCents: status === "OPEN" ? estimateOwed(num(row.exchange_rate), num(row.commission_percent), summary) : null,
      paidMxnCents: paidCents,
      balanceMxnCents: owed === null ? null : owed - paidCents,
    };
  });

  return {
    purchases,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? purchases.length,
    hasNextPage: (count ?? 0) > from + PAGE_SIZE,
    unavailable: false,
  };
}

export type ShopperBalance = {
  supplierId: string;
  name: string;
  company: string | null;
  openCount: number;
  confirmedCount: number;
  /** Σ owed_mxn of CONFIRMED purchases. */
  owedMxnCents: number;
  /** Σ non-voided abonos (tied to a purchase or general). */
  paidMxnCents: number;
  /** Part of paidMxnCents that is not tied to a purchase. */
  generalPaidMxnCents: number;
  /** owed − paid. Negative = saldo a favor de la dueña. */
  balanceMxnCents: number;
};

/**
 * Global account per shopper: confirmed purchases minus every abono that has
 * not been voided. OPEN purchases do not count yet (nothing is owed until the
 * tickets are squared and confirmed); general abonos do.
 */
export async function getShopperBalances(): Promise<{ balances: ShopperBalance[]; unavailable: boolean }> {
  const db = adminDb();
  const [purchasesResult, paymentsResult] = await Promise.all([
    db.from("purchases").select("supplier_id, status, owed_mxn_cents").eq("business_id", DEFAULT_BUSINESS_ID).neq("status", "CANCELLED"),
    db.from("shopper_payments").select("supplier_id, purchase_id, amount_mxn_cents, voided_at").eq("business_id", DEFAULT_BUSINESS_ID),
  ]);
  for (const result of [purchasesResult, paymentsResult]) {
    if (result.error) {
      if (isMissingPurchaseSchema(result.error.message)) return { balances: [], unavailable: true };
      throw new Error(result.error.message);
    }
  }

  const bySupplier = new Map<string, Omit<ShopperBalance, "name" | "company" | "balanceMxnCents">>();
  const entry = (supplierId: string) => {
    const current =
      bySupplier.get(supplierId) ??
      { supplierId, openCount: 0, confirmedCount: 0, owedMxnCents: 0, paidMxnCents: 0, generalPaidMxnCents: 0 };
    bySupplier.set(supplierId, current);
    return current;
  };
  for (const row of purchasesResult.data ?? []) {
    const current = entry(row.supplier_id as string);
    if (row.status === "OPEN") current.openCount += 1;
    if (row.status === "CONFIRMED") {
      current.confirmedCount += 1;
      current.owedMxnCents += num(row.owed_mxn_cents);
    }
  }
  for (const row of paymentsResult.data ?? []) {
    if (row.voided_at) continue;
    const current = entry(row.supplier_id as string);
    current.paidMxnCents += num(row.amount_mxn_cents);
    if (!row.purchase_id) current.generalPaidMxnCents += num(row.amount_mxn_cents);
  }

  const ids = [...bySupplier.keys()];
  const names = new Map<string, { name: string; company: string | null }>();
  if (ids.length) {
    const { data, error } = await db.from("suppliers").select("id, name, company").in("id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) names.set(row.id as string, { name: row.name as string, company: (row.company as string | null) ?? null });
  }

  const balances = [...bySupplier.values()]
    .map((row) => ({
      ...row,
      name: names.get(row.supplierId)?.name ?? "Shopper eliminado",
      company: names.get(row.supplierId)?.company ?? null,
      balanceMxnCents: row.owedMxnCents - row.paidMxnCents,
    }))
    .sort((a, b) => b.balanceMxnCents - a.balanceMxnCents || a.name.localeCompare(b.name, "es"));
  return { balances, unavailable: false };
}

export type PurchaseItemDetail = {
  id: string;
  ticket_id: string;
  name: string;
  variant_label: string | null;
  quantity: number;
  unit_price_usd_cents: number;
  subtotalUsdCents: number;
  status: PurchaseItemStatus;
  line_cost_mxn_cents: number | null;
  unit_cost_mxn_cents: number | null;
  photoUrl: string | null;
  created_at: string;
};

export type PurchaseTicketDetail = {
  id: string;
  store_name: string;
  reference: string | null;
  tax_usd_cents: number;
  real_total_usd_cents: number | null;
  hasPhoto: boolean;
  /** Signed, short-lived. null when there is no photo or it could not be signed. */
  photoUrl: string | null;
  items: PurchaseItemDetail[];
  summary: TicketSummary;
  created_at: string;
};

export type ShopperPaymentRow = {
  id: string;
  purchase_id: string | null;
  amount_mxn_cents: number;
  paid_on: string;
  method: ShopperPaymentMethod;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
};

export type PurchaseDetail = {
  purchase: {
    id: string;
    purchase_number: string;
    supplier_id: string;
    purchase_date: string;
    exchange_rate: number;
    commission_percent: number;
    status: PurchaseStatus;
    notes: string | null;
    captured_subtotal_usd_cents: number | null;
    tax_usd_cents: number | null;
    total_real_usd_cents: number | null;
    difference_usd_cents: number | null;
    difference_acknowledged: boolean;
    commission_usd_cents: number | null;
    owed_usd_cents: number | null;
    owed_mxn_cents: number | null;
    confirmed_at: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    created_at: string;
  };
  supplier: SupplierRef | null;
  tickets: PurchaseTicketDetail[];
  stores: StoreSummary[];
  summary: PurchaseSummary;
  /** While OPEN, with the totals known so far. */
  estimate: { commissionUsdCents: number; owedUsdCents: number; owedMxnCents: number } | null;
  payments: ShopperPaymentRow[];
  paidMxnCents: number;
  balanceMxnCents: number | null;
};

async function signedTicketUrls(keys: string[]) {
  const urls = new Map<string, string>();
  if (!keys.length) return urls;
  try {
    const { data, error } = await adminStorage().from(EXPENSE_RECEIPT_BUCKET).createSignedUrls(keys, SIGNED_URL_SECONDS);
    if (error) return urls;
    for (const entry of data ?? []) if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  } catch {
    // A missing signature only hides the thumbnail; the ticket itself still renders.
  }
  return urls;
}

function itemPhotoUrl(key: string | null) {
  if (!key) return null;
  return adminStorage().from(PRODUCT_IMAGE_BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Throws on unexpected errors; a missing migration throws with the message naming 010. */
export async function getPurchaseDetail(id: string): Promise<PurchaseDetail | null> {
  const db = adminDb();
  const { data: purchase, error } = await db
    .from("purchases")
    .select(
      "id, purchase_number, supplier_id, purchase_date, exchange_rate, commission_percent, status, notes, captured_subtotal_usd_cents, tax_usd_cents, total_real_usd_cents, difference_usd_cents, difference_acknowledged, commission_usd_cents, owed_usd_cents, owed_mxn_cents, confirmed_at, cancelled_at, cancellation_reason, created_at, suppliers(id, name, company, is_active)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(isMissingPurchaseSchema(error.message) ? PURCHASES_UNAVAILABLE_MESSAGE : error.message);
  if (!purchase) return null;

  const [ticketsResult, itemsResult, paymentsResult] = await Promise.all([
    db
      .from("purchase_tickets")
      .select("id, store_name, reference, photo_storage_key, tax_usd_cents, real_total_usd_cents, created_at")
      .eq("purchase_id", id)
      .order("created_at", { ascending: true }),
    db
      .from("purchase_items")
      .select("id, ticket_id, name, variant_label, quantity, unit_price_usd_cents, photo_storage_key, status, line_cost_mxn_cents, unit_cost_mxn_cents, created_at")
      .eq("purchase_id", id)
      .order("created_at", { ascending: true }),
    db
      .from("shopper_payments")
      .select("id, purchase_id, amount_mxn_cents, paid_on, method, note, voided_at, void_reason, created_at")
      .eq("purchase_id", id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  for (const result of [ticketsResult, itemsResult, paymentsResult]) if (result.error) throw new Error(result.error.message);

  const ticketRows = ticketsResult.data ?? [];
  const signed = await signedTicketUrls(ticketRows.map((row) => row.photo_storage_key as string | null).filter((key): key is string => Boolean(key)));

  const items: PurchaseItemDetail[] = (itemsResult.data ?? []).map((row) => ({
    id: row.id as string,
    ticket_id: row.ticket_id as string,
    name: row.name as string,
    variant_label: (row.variant_label as string | null) ?? null,
    quantity: num(row.quantity),
    unit_price_usd_cents: num(row.unit_price_usd_cents),
    subtotalUsdCents: num(row.quantity) * num(row.unit_price_usd_cents),
    status: row.status as PurchaseItemStatus,
    line_cost_mxn_cents: numOrNull(row.line_cost_mxn_cents),
    unit_cost_mxn_cents: numOrNull(row.unit_cost_mxn_cents),
    photoUrl: itemPhotoUrl((row.photo_storage_key as string | null) ?? null),
    created_at: row.created_at as string,
  }));

  const tickets: PurchaseTicketDetail[] = ticketRows.map((row) => {
    const ticketItems = items.filter((item) => item.ticket_id === row.id);
    const key = (row.photo_storage_key as string | null) ?? null;
    return {
      id: row.id as string,
      store_name: row.store_name as string,
      reference: (row.reference as string | null) ?? null,
      tax_usd_cents: num(row.tax_usd_cents),
      real_total_usd_cents: numOrNull(row.real_total_usd_cents),
      hasPhoto: Boolean(key),
      photoUrl: key ? (signed.get(key) ?? null) : null,
      items: ticketItems,
      summary: summarizeTicket({
        taxUsdCents: num(row.tax_usd_cents),
        realTotalUsdCents: numOrNull(row.real_total_usd_cents),
        items: ticketItems.map((item) => ({ quantity: item.quantity, unitPriceUsdCents: item.unit_price_usd_cents })),
      }),
      created_at: row.created_at as string,
    };
  });

  const summary = summarizePurchase(tickets.map((ticket) => ticket.summary));
  const payments: ShopperPaymentRow[] = (paymentsResult.data ?? []).map((row) => ({
    id: row.id as string,
    purchase_id: (row.purchase_id as string | null) ?? null,
    amount_mxn_cents: num(row.amount_mxn_cents),
    paid_on: row.paid_on as string,
    method: row.method as ShopperPaymentMethod,
    note: (row.note as string | null) ?? null,
    voided_at: (row.voided_at as string | null) ?? null,
    void_reason: (row.void_reason as string | null) ?? null,
    created_at: row.created_at as string,
  }));
  const paidMxnCents = payments.filter((payment) => !payment.voided_at).reduce((sum, payment) => sum + payment.amount_mxn_cents, 0);
  const status = purchase.status as PurchaseStatus;
  const rate = num(purchase.exchange_rate);
  const commission = num(purchase.commission_percent);
  const owedMxn = numOrNull(purchase.owed_mxn_cents);

  let estimate: PurchaseDetail["estimate"] = null;
  if (status === "OPEN") {
    try {
      estimate = computeOwed(summary.bestTotalUsdCents, commission, rate);
    } catch {
      estimate = null;
    }
  }

  return {
    purchase: {
      id: purchase.id as string,
      purchase_number: purchase.purchase_number as string,
      supplier_id: purchase.supplier_id as string,
      purchase_date: purchase.purchase_date as string,
      exchange_rate: rate,
      commission_percent: commission,
      status,
      notes: (purchase.notes as string | null) ?? null,
      captured_subtotal_usd_cents: numOrNull(purchase.captured_subtotal_usd_cents),
      tax_usd_cents: numOrNull(purchase.tax_usd_cents),
      total_real_usd_cents: numOrNull(purchase.total_real_usd_cents),
      difference_usd_cents: numOrNull(purchase.difference_usd_cents),
      difference_acknowledged: Boolean(purchase.difference_acknowledged),
      commission_usd_cents: numOrNull(purchase.commission_usd_cents),
      owed_usd_cents: numOrNull(purchase.owed_usd_cents),
      owed_mxn_cents: owedMxn,
      confirmed_at: (purchase.confirmed_at as string | null) ?? null,
      cancelled_at: (purchase.cancelled_at as string | null) ?? null,
      cancellation_reason: (purchase.cancellation_reason as string | null) ?? null,
      created_at: purchase.created_at as string,
    },
    supplier: relation(purchase.suppliers as unknown as SupplierRef[]),
    tickets,
    stores: summarizeStores(tickets.map((ticket) => ({ storeName: ticket.store_name, summary: ticket.summary }))),
    summary,
    estimate,
    payments,
    paidMxnCents,
    balanceMxnCents: status === "CONFIRMED" && owedMxn !== null ? owedMxn - paidMxnCents : null,
  };
}

/** Store names already used, most recent first, for the ticket form's suggestions. */
export async function listStoreSuggestions(limit = 300): Promise<string[]> {
  const { data, error } = await adminDb()
    .from("purchase_tickets")
    .select("store_name, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  // One suggestion per store (same grouping as the per-store totals), spelled
  // the way it was typed most often; stores ordered by most recent use.
  const stores = new Map<string, Map<string, number>>();
  for (const row of data ?? []) {
    const name = text(row.store_name);
    if (!name) continue;
    const key = storeKey(name);
    const spellings = stores.get(key) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
    stores.set(key, spellings);
  }
  return [...stores.values()].map((spellings) =>
    [...spellings.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0],
  );
}

/** Last exchange rate typed in a purchase: shown as a hint only, never pre-filled. */
export async function getLastExchangeRate(): Promise<number | null> {
  const { data, error } = await adminDb()
    .from("purchases")
    .select("exchange_rate, created_at")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return num(data[0].exchange_rate) || null;
}

/** General abonos (not tied to a purchase) of one shopper, newest first. */
export async function listGeneralPayments(limit = 50): Promise<Array<ShopperPaymentRow & { supplierName: string }>> {
  const { data, error } = await adminDb()
    .from("shopper_payments")
    .select("id, supplier_id, purchase_id, amount_mxn_cents, paid_on, method, note, voided_at, void_reason, created_at, suppliers(name)")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .is("purchase_id", null)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id as string,
    purchase_id: null,
    amount_mxn_cents: num(row.amount_mxn_cents),
    paid_on: row.paid_on as string,
    method: row.method as ShopperPaymentMethod,
    note: (row.note as string | null) ?? null,
    voided_at: (row.voided_at as string | null) ?? null,
    void_reason: (row.void_reason as string | null) ?? null,
    created_at: row.created_at as string,
    supplierName: relation(row.suppliers as unknown as Array<{ name: string }>)?.name ?? "Shopper eliminado",
  }));
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export type PhotoKind = "item" | "ticket";

function photoBucket(kind: PhotoKind) {
  return kind === "item" ? PRODUCT_IMAGE_BUCKET : EXPENSE_RECEIPT_BUCKET;
}

export function validatePhoto(file: File | null | undefined): string | null {
  if (!file || file.size === 0) return null;
  if (!PHOTO_EXTENSIONS[file.type]) return "La foto debe ser JPG, PNG o WEBP.";
  if (file.size > MAX_PURCHASE_PHOTO_BYTES) return "La foto debe pesar 5 MB o menos.";
  return null;
}

/**
 * Item photos live in the public catalogue bucket (phase 4 publishes them as
 * "Próximamente" without copying); ticket photos in the private expense-receipts
 * bucket. Keys are namespaced so they never collide with catalogue/expense files.
 */
export async function uploadPurchasePhoto(kind: PhotoKind, purchaseId: string, file: File): Promise<Result<{ key: string }>> {
  const invalid = validatePhoto(file);
  if (invalid) return fail(invalid);
  const folder = kind === "item" ? "shopper-purchases" : "shopper-tickets";
  const key = `${folder}/${purchaseId}/${crypto.randomUUID()}.${PHOTO_EXTENSIONS[file.type]}`;
  const { error } = await adminStorage().from(photoBucket(kind)).upload(key, file, { contentType: file.type, upsert: false });
  if (error) return fail(`No fue posible subir la foto (${error.message}).`);
  return { ok: true, key };
}

async function removePhotos(kind: PhotoKind, keys: Array<string | null | undefined>) {
  const list = keys.filter((key): key is string => Boolean(key));
  if (!list.length) return;
  try {
    await adminStorage().from(photoBucket(kind)).remove(list);
  } catch {
    // An orphaned file is harmless; failing the edit over it would not be.
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function readPurchaseState(purchaseId: string): Promise<Result<{ status: PurchaseStatus; supplierId: string }>> {
  if (!purchaseId) return fail("Compra no encontrada.");
  const { data, error } = await adminDb().from("purchases").select("id, status, supplier_id").eq("id", purchaseId).maybeSingle();
  if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer la compra."));
  if (!data) return fail("Compra no encontrada.");
  return { ok: true, status: data.status as PurchaseStatus, supplierId: data.supplier_id as string };
}

function openGuard(status: PurchaseStatus): string | null {
  if (status === "CONFIRMED") return "Esta compra ya está confirmada: sus tickets y artículos ya no se pueden modificar.";
  if (status === "CANCELLED") return "Esta compra está cancelada.";
  return null;
}

type HeaderInput = {
  supplierId: unknown;
  purchaseDate: unknown;
  exchangeRate: unknown;
  commission: unknown;
  notes?: unknown;
};

async function parseHeader(input: HeaderInput): Promise<
  Result<{ values: { supplier_id: string; purchase_date: string; exchange_rate: number; commission_percent: number; notes: string | null } }>
> {
  const supplierId = text(input.supplierId);
  if (!supplierId) return fail("Elige al shopper de esta compra.");
  const date = parseDate(input.purchaseDate, "de la compra");
  if (!date.ok) return date;
  const rate = parseExchangeRate(input.exchangeRate);
  if (!rate.ok) return fail(rate.error);
  const commission = parseCommission(input.commission);
  if (!commission.ok) return fail(commission.error);
  const notes = text(input.notes);
  if (notes.length > 1000) return fail("Las notas no pueden exceder 1000 caracteres.");

  const { data: supplier, error } = await adminDb().from("suppliers").select("id, is_active").eq("id", supplierId).maybeSingle();
  if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer el shopper."));
  if (!supplier) return fail("Ese shopper ya no existe.");

  return {
    ok: true,
    values: {
      supplier_id: supplierId,
      purchase_date: date.value,
      exchange_rate: rate.value,
      commission_percent: commission.value,
      notes: notes || null,
    },
  };
}

export async function createPurchase(input: HeaderInput & { adminId: string }): Promise<Result<{ id: string; purchaseNumber: string }>> {
  const parsed = await parseHeader(input);
  if (!parsed.ok) return parsed;
  const { data, error } = await adminDb()
    .from("purchases")
    .insert({ ...parsed.values, business_id: DEFAULT_BUSINESS_ID, status: "OPEN", created_by_admin_id: input.adminId })
    .select("id, purchase_number")
    .single();
  if (error || !data) return fail(describePurchaseError(new Error(error?.message ?? "sin respuesta"), "No fue posible abrir la compra."));

  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_PURCHASE_OPENED",
    entityType: "purchases",
    entityId: data.id as string,
    newData: parsed.values,
  });
  return { ok: true, id: data.id as string, purchaseNumber: data.purchase_number as string };
}

/** Shopper, date, exchange rate, commission and notes, while the purchase is still OPEN. */
export async function updatePurchaseHeader(input: HeaderInput & { adminId: string; purchaseId: string }): Promise<Result> {
  const state = await readPurchaseState(input.purchaseId);
  if (!state.ok) return state;
  const blocked = openGuard(state.status);
  if (blocked) return fail(blocked);
  const parsed = await parseHeader(input);
  if (!parsed.ok) return parsed;

  const { data, error } = await adminDb()
    .from("purchases")
    .update({ ...parsed.values, updated_at: new Date().toISOString() })
    .eq("id", input.purchaseId)
    .eq("status", "OPEN")
    .select("id");
  if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible guardar la compra."));
  if (!data?.length) return fail("Esta compra ya no está abierta.");

  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_PURCHASE_UPDATED",
    entityType: "purchases",
    entityId: input.purchaseId,
    newData: parsed.values,
  });
  return { ok: true };
}

/** Only OPEN purchases are cancelled (phase 1). Nothing is deleted. */
export async function cancelPurchase(input: { adminId: string; purchaseId: string; reason?: unknown }): Promise<Result> {
  const state = await readPurchaseState(input.purchaseId);
  if (!state.ok) return state;
  if (state.status === "CONFIRMED") return fail("Una compra confirmada no se puede cancelar.");
  if (state.status === "CANCELLED") return fail("Esta compra ya está cancelada.");
  const reason = text(input.reason).slice(0, 500) || null;

  const { data, error } = await adminDb()
    .from("purchases")
    .update({
      status: "CANCELLED",
      cancelled_at: new Date().toISOString(),
      cancelled_by_admin_id: input.adminId,
      cancellation_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.purchaseId)
    .eq("status", "OPEN")
    .select("id");
  if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible cancelar la compra."));
  if (!data?.length) return fail("Esta compra ya no está abierta.");

  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_PURCHASE_CANCELLED",
    entityType: "purchases",
    entityId: input.purchaseId,
    newData: { reason },
  });
  return { ok: true };
}

function parseUsdField(raw: unknown, label: string, { required }: { required: boolean }): Result<{ value: number | null }> {
  const typed = text(raw);
  if (!typed) return required ? fail(`Escribe ${label}.`) : { ok: true, value: null };
  if (typed.startsWith("-")) return fail(`${label[0].toUpperCase()}${label.slice(1)} no puede ser negativo.`);
  const cents = parseUsdToCents(typed);
  if (cents === null || Number.isNaN(cents)) return fail(`Escribe ${label} en dólares válido (por ejemplo 24.50).`);
  if (cents > MAX_USD_CENTS) return fail(`${label[0].toUpperCase()}${label.slice(1)} es demasiado alto. Revísalo.`);
  return { ok: true, value: cents };
}

export type TicketInput = {
  adminId: string;
  purchaseId: string;
  /** Present when editing. */
  ticketId?: string;
  storeName: unknown;
  reference?: unknown;
  tax?: unknown;
  realTotal?: unknown;
  photo?: File | null;
  removePhoto?: boolean;
};

export async function saveTicket(input: TicketInput): Promise<Result<{ ticketId: string }>> {
  const storeName = text(input.storeName).replace(/\s+/g, " ");
  if (!storeName) return fail("Escribe el nombre de la tienda.");
  if (storeName.length > 80) return fail("El nombre de la tienda no puede exceder 80 caracteres.");
  const reference = text(input.reference).slice(0, 80) || null;
  const tax = parseUsdField(input.tax, "el tax del ticket", { required: false });
  if (!tax.ok) return tax;
  const real = parseUsdField(input.realTotal, "el total del ticket", { required: false });
  if (!real.ok) return real;
  const invalidPhoto = validatePhoto(input.photo);
  if (invalidPhoto) return fail(invalidPhoto);

  const state = await readPurchaseState(input.purchaseId);
  if (!state.ok) return state;
  const blocked = openGuard(state.status);
  if (blocked) return fail(blocked);

  const db = adminDb();
  let previousPhoto: string | null = null;
  if (input.ticketId) {
    const { data: existing, error } = await db
      .from("purchase_tickets")
      .select("id, photo_storage_key")
      .eq("id", input.ticketId)
      .eq("purchase_id", input.purchaseId)
      .maybeSingle();
    if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer el ticket."));
    if (!existing) return fail("Ticket no encontrado.");
    previousPhoto = (existing.photo_storage_key as string | null) ?? null;
  }

  let newPhoto: string | null = null;
  if (input.photo && input.photo.size > 0) {
    const uploaded = await uploadPurchasePhoto("ticket", input.purchaseId, input.photo);
    if (!uploaded.ok) return uploaded;
    newPhoto = uploaded.key;
  }

  const values: Record<string, unknown> = {
    store_name: storeName,
    reference,
    tax_usd_cents: tax.value ?? 0,
    real_total_usd_cents: real.value,
    updated_at: new Date().toISOString(),
  };
  if (newPhoto) values.photo_storage_key = newPhoto;
  else if (input.removePhoto) values.photo_storage_key = null;

  let ticketId = input.ticketId ?? "";
  if (input.ticketId) {
    const { error } = await db.from("purchase_tickets").update(values).eq("id", input.ticketId).eq("purchase_id", input.purchaseId);
    if (error) {
      await removePhotos("ticket", [newPhoto]);
      return fail(describePurchaseError(new Error(error.message), "No fue posible guardar el ticket."));
    }
    if (newPhoto || input.removePhoto) await removePhotos("ticket", [previousPhoto]);
  } else {
    const { data, error } = await db
      .from("purchase_tickets")
      .insert({ ...values, purchase_id: input.purchaseId, created_by_admin_id: input.adminId })
      .select("id")
      .single();
    if (error || !data) {
      await removePhotos("ticket", [newPhoto]);
      return fail(describePurchaseError(new Error(error?.message ?? "sin respuesta"), "No fue posible agregar el ticket."));
    }
    ticketId = data.id as string;
  }

  await logActivity({
    adminUserId: input.adminId,
    action: input.ticketId ? "SHOPPER_TICKET_UPDATED" : "SHOPPER_TICKET_ADDED",
    entityType: "purchase_tickets",
    entityId: ticketId,
    newData: { purchaseId: input.purchaseId, storeName, reference, tax_usd_cents: tax.value ?? 0, real_total_usd_cents: real.value, photo: Boolean(newPhoto) },
  });
  return { ok: true, ticketId };
}

export async function deleteTicket(input: { adminId: string; purchaseId: string; ticketId: string }): Promise<Result> {
  const state = await readPurchaseState(input.purchaseId);
  if (!state.ok) return state;
  const blocked = openGuard(state.status);
  if (blocked) return fail(blocked);

  const db = adminDb();
  const [{ data: ticket, error }, { data: items, error: itemsError }] = await Promise.all([
    db.from("purchase_tickets").select("id, store_name, photo_storage_key").eq("id", input.ticketId).eq("purchase_id", input.purchaseId).maybeSingle(),
    db.from("purchase_items").select("id, photo_storage_key").eq("ticket_id", input.ticketId),
  ]);
  if (error || itemsError) return fail(describePurchaseError(new Error((error ?? itemsError)!.message), "No fue posible leer el ticket."));
  if (!ticket) return fail("Ticket no encontrado.");

  // purchase_items cascade with the ticket (and the guard trigger re-checks OPEN).
  const { error: deleteError } = await db.from("purchase_tickets").delete().eq("id", input.ticketId).eq("purchase_id", input.purchaseId);
  if (deleteError) return fail(describePurchaseError(new Error(deleteError.message), "No fue posible borrar el ticket."));
  await removePhotos("ticket", [ticket.photo_storage_key as string | null]);
  await removePhotos("item", (items ?? []).map((item) => item.photo_storage_key as string | null));

  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_TICKET_DELETED",
    entityType: "purchase_tickets",
    entityId: input.ticketId,
    previousData: { purchaseId: input.purchaseId, storeName: ticket.store_name, items: items?.length ?? 0 },
  });
  return { ok: true };
}

export type ItemInput = {
  adminId: string;
  purchaseId: string;
  ticketId: string;
  /** Present when editing. */
  itemId?: string;
  name: unknown;
  variant?: unknown;
  quantity: unknown;
  unitPrice: unknown;
  photo?: File | null;
  removePhoto?: boolean;
};

export async function saveItem(input: ItemInput): Promise<Result<{ itemId: string }>> {
  const name = text(input.name).replace(/\s+/g, " ");
  if (!name) return fail("Escribe el nombre del producto.");
  if (name.length > 140) return fail("El nombre no puede exceder 140 caracteres.");
  const variant = text(input.variant).slice(0, 80) || null;
  const quantityText = text(input.quantity);
  if (!/^-?\d+$/.test(quantityText)) return fail("La cantidad debe ser un número entero (1, 2, 3…).");
  const quantity = Number(quantityText);
  if (quantity < 1) return fail("La cantidad debe ser al menos 1.");
  if (quantity > MAX_ITEM_QUANTITY) return fail("Esa cantidad es demasiado alta. Revísala.");
  const price = parseUsdField(input.unitPrice, "el precio", { required: true });
  if (!price.ok) return price;
  const invalidPhoto = validatePhoto(input.photo);
  if (invalidPhoto) return fail(invalidPhoto);

  const state = await readPurchaseState(input.purchaseId);
  if (!state.ok) return state;
  const blocked = openGuard(state.status);
  if (blocked) return fail(blocked);

  const db = adminDb();
  const { data: ticket, error: ticketError } = await db
    .from("purchase_tickets")
    .select("id")
    .eq("id", input.ticketId)
    .eq("purchase_id", input.purchaseId)
    .maybeSingle();
  if (ticketError) return fail(describePurchaseError(new Error(ticketError.message), "No fue posible leer el ticket."));
  if (!ticket) return fail("Ticket no encontrado.");

  let previousPhoto: string | null = null;
  if (input.itemId) {
    const { data: existing, error } = await db
      .from("purchase_items")
      .select("id, photo_storage_key")
      .eq("id", input.itemId)
      .eq("purchase_id", input.purchaseId)
      .maybeSingle();
    if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer el artículo."));
    if (!existing) return fail("Artículo no encontrado.");
    previousPhoto = (existing.photo_storage_key as string | null) ?? null;
  }

  let newPhoto: string | null = null;
  if (input.photo && input.photo.size > 0) {
    const uploaded = await uploadPurchasePhoto("item", input.purchaseId, input.photo);
    if (!uploaded.ok) return uploaded;
    newPhoto = uploaded.key;
  }

  const values: Record<string, unknown> = {
    ticket_id: input.ticketId,
    name,
    variant_label: variant,
    quantity,
    unit_price_usd_cents: price.value,
    updated_at: new Date().toISOString(),
  };
  if (newPhoto) values.photo_storage_key = newPhoto;
  else if (input.removePhoto) values.photo_storage_key = null;

  let itemId = input.itemId ?? "";
  if (input.itemId) {
    const { error } = await db.from("purchase_items").update(values).eq("id", input.itemId).eq("purchase_id", input.purchaseId);
    if (error) {
      await removePhotos("item", [newPhoto]);
      return fail(describePurchaseError(new Error(error.message), "No fue posible guardar el artículo."));
    }
    if (newPhoto || input.removePhoto) await removePhotos("item", [previousPhoto]);
  } else {
    const { data, error } = await db
      .from("purchase_items")
      .insert({ ...values, purchase_id: input.purchaseId, status: "CAPTURED", created_by_admin_id: input.adminId })
      .select("id")
      .single();
    if (error || !data) {
      await removePhotos("item", [newPhoto]);
      return fail(describePurchaseError(new Error(error?.message ?? "sin respuesta"), "No fue posible agregar el artículo."));
    }
    itemId = data.id as string;
  }

  await logActivity({
    adminUserId: input.adminId,
    action: input.itemId ? "SHOPPER_ITEM_UPDATED" : "SHOPPER_ITEM_ADDED",
    entityType: "purchase_items",
    entityId: itemId,
    newData: { purchaseId: input.purchaseId, ticketId: input.ticketId, name, variant, quantity, unit_price_usd_cents: price.value, photo: Boolean(newPhoto) },
  });
  return { ok: true, itemId };
}

export async function deleteItem(input: { adminId: string; purchaseId: string; itemId: string }): Promise<Result> {
  const state = await readPurchaseState(input.purchaseId);
  if (!state.ok) return state;
  const blocked = openGuard(state.status);
  if (blocked) return fail(blocked);

  const db = adminDb();
  const { data: item, error } = await db
    .from("purchase_items")
    .select("id, name, quantity, unit_price_usd_cents, photo_storage_key")
    .eq("id", input.itemId)
    .eq("purchase_id", input.purchaseId)
    .maybeSingle();
  if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer el artículo."));
  if (!item) return fail("Artículo no encontrado.");

  const { error: deleteError } = await db.from("purchase_items").delete().eq("id", input.itemId).eq("purchase_id", input.purchaseId);
  if (deleteError) return fail(describePurchaseError(new Error(deleteError.message), "No fue posible borrar el artículo."));
  await removePhotos("item", [item.photo_storage_key as string | null]);

  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_ITEM_DELETED",
    entityType: "purchase_items",
    entityId: input.itemId,
    previousData: { purchaseId: input.purchaseId, name: item.name, quantity: item.quantity, unit_price_usd_cents: item.unit_price_usd_cents },
  });
  return { ok: true };
}

/**
 * "Confirmar compra". Reads the purchase as it is now, computes the frozen
 * snapshot in TypeScript (purchase-math.ts) and hands it to
 * confirm_shopper_purchase(), which re-checks in one transaction that nothing
 * changed and writes purchase + lines atomically. Calling it twice fails the
 * second time (the purchase is no longer OPEN).
 */
export async function confirmPurchase(input: {
  adminId: string;
  purchaseId: string;
  acknowledgeDifference: boolean;
}): Promise<Result<{ snapshot: ConfirmationSnapshot; missingTicketPhotos: number }>> {
  const db = adminDb();
  const { data: purchase, error } = await db
    .from("purchases")
    .select("id, status, exchange_rate, commission_percent")
    .eq("id", input.purchaseId)
    .maybeSingle();
  if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer la compra."));
  if (!purchase) return fail("Compra no encontrada.");
  if (purchase.status === "CONFIRMED") return fail("Esta compra ya está confirmada.");
  if (purchase.status === "CANCELLED") return fail("Esta compra está cancelada.");

  const [ticketsResult, itemsResult] = await Promise.all([
    db
      .from("purchase_tickets")
      .select("id, store_name, tax_usd_cents, real_total_usd_cents, photo_storage_key, created_at")
      .eq("purchase_id", input.purchaseId)
      .order("created_at", { ascending: true }),
    db
      .from("purchase_items")
      .select("id, ticket_id, quantity, unit_price_usd_cents, created_at")
      .eq("purchase_id", input.purchaseId)
      .order("created_at", { ascending: true }),
  ]);
  for (const result of [ticketsResult, itemsResult]) {
    if (result.error) return fail(describePurchaseError(new Error(result.error.message), "No fue posible leer la compra."));
  }
  const ticketRows = ticketsResult.data ?? [];
  const itemRows = itemsResult.data ?? [];

  const computed = computePurchaseConfirmation({
    exchangeRate: num(purchase.exchange_rate),
    commissionPercent: num(purchase.commission_percent),
    acknowledgeDifference: input.acknowledgeDifference,
    tickets: ticketRows.map((ticket) => ({
      id: ticket.id as string,
      storeName: ticket.store_name as string,
      taxUsdCents: num(ticket.tax_usd_cents),
      realTotalUsdCents: numOrNull(ticket.real_total_usd_cents),
      items: itemRows
        .filter((item) => item.ticket_id === ticket.id)
        .map((item) => ({ id: item.id as string, quantity: num(item.quantity), unitPriceUsdCents: num(item.unit_price_usd_cents) })),
    })),
  });
  if (!computed.ok) return computed;

  const { error: rpcError } = await db.rpc("confirm_shopper_purchase", {
    p_purchase_id: input.purchaseId,
    p_admin_id: input.adminId,
    p_snapshot: computed.snapshot,
  });
  if (rpcError) return fail(describePurchaseError(new Error(rpcError.message), "No fue posible confirmar la compra."));

  const snapshot = computed.snapshot;
  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_PURCHASE_CONFIRMED",
    entityType: "purchases",
    entityId: input.purchaseId,
    newData: {
      total_real_usd_cents: snapshot.total_real_usd_cents,
      commission_usd_cents: snapshot.commission_usd_cents,
      owed_usd_cents: snapshot.owed_usd_cents,
      owed_mxn_cents: snapshot.owed_mxn_cents,
      exchange_rate: snapshot.exchange_rate,
      commission_percent: snapshot.commission_percent,
      difference_usd_cents: snapshot.difference_usd_cents,
      difference_acknowledged: snapshot.difference_acknowledged,
      items: snapshot.items.length,
    },
  });
  return { ok: true, snapshot, missingTicketPhotos: ticketRows.filter((ticket) => !ticket.photo_storage_key).length };
}

export async function registerShopperPayment(input: {
  adminId: string;
  supplierId: unknown;
  purchaseId?: unknown;
  amount: unknown;
  paidOn: unknown;
  method: unknown;
  note?: unknown;
}): Promise<Result<{ paymentId: string }>> {
  const typedAmount = text(input.amount);
  if (typedAmount.startsWith("-")) return fail("El abono no puede ser negativo.");
  const amount = parseMoneyToCents(typedAmount);
  if (amount === null || amount <= 0) return fail("Escribe el monto del abono en pesos (mayor a cero).");
  if (amount > MAX_PAYMENT_MXN_CENTS) return fail("Ese monto es demasiado alto. Revísalo.");
  const date = parseDate(input.paidOn, "del abono");
  if (!date.ok) return date;
  const method = text(input.method) as ShopperPaymentMethod;
  if (!SHOPPER_PAYMENT_METHODS.includes(method)) return fail("Elige cómo le pagaste: efectivo, transferencia u otro.");
  const note = text(input.note).slice(0, 500) || null;
  const purchaseId = text(input.purchaseId) || null;
  let supplierId = text(input.supplierId);

  const db = adminDb();
  if (purchaseId) {
    const { data: purchase, error } = await db
      .from("purchases")
      .select("id, status, supplier_id, owed_mxn_cents")
      .eq("id", purchaseId)
      .maybeSingle();
    if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer la compra."));
    if (!purchase) return fail("Compra no encontrada.");
    if (purchase.status !== "CONFIRMED") return fail("Solo se registran abonos sobre compras confirmadas.");
    if (supplierId && supplierId !== purchase.supplier_id) return fail("Ese abono no corresponde al shopper de la compra.");
    supplierId = purchase.supplier_id as string;
    const { data: payments, error: paymentsError } = await db
      .from("shopper_payments")
      .select("amount_mxn_cents, voided_at")
      .eq("purchase_id", purchaseId);
    if (paymentsError) return fail(describePurchaseError(new Error(paymentsError.message), "No fue posible leer los abonos."));
    const paid = (payments ?? []).filter((row) => !row.voided_at).reduce((sum, row) => sum + num(row.amount_mxn_cents), 0);
    const pending = num(purchase.owed_mxn_cents) - paid;
    if (amount > pending) {
      return fail(
        pending <= 0
          ? "Esta compra ya está liquidada. Si le adelantaste dinero al shopper, regístralo como abono general."
          : `El abono excede el saldo pendiente de esta compra (${(pending / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}).`,
      );
    }
  } else {
    if (!supplierId) return fail("Elige al shopper.");
    const { data: supplier, error } = await db.from("suppliers").select("id").eq("id", supplierId).maybeSingle();
    if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer el shopper."));
    if (!supplier) return fail("Ese shopper ya no existe.");
  }

  const { data, error } = await db
    .from("shopper_payments")
    .insert({
      business_id: DEFAULT_BUSINESS_ID,
      supplier_id: supplierId,
      purchase_id: purchaseId,
      amount_mxn_cents: amount,
      paid_on: date.value,
      method,
      note,
      created_by_admin_id: input.adminId,
    })
    .select("id")
    .single();
  if (error || !data) return fail(describePurchaseError(new Error(error?.message ?? "sin respuesta"), "No fue posible registrar el abono."));

  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_PAYMENT_REGISTERED",
    entityType: "shopper_payments",
    entityId: data.id as string,
    newData: { supplierId, purchaseId, amount_mxn_cents: amount, paid_on: date.value, method, note },
  });
  return { ok: true, paymentId: data.id as string };
}

/** An abono is never edited or deleted: it is voided with a reason, and stays listed. */
export async function voidShopperPayment(input: { adminId: string; paymentId: string; reason: unknown }): Promise<Result<{ purchaseId: string | null }>> {
  const reason = text(input.reason).slice(0, 500);
  if (!reason) return fail("Escribe el motivo para anular el abono.");
  if (!input.paymentId) return fail("Abono no encontrado.");

  const db = adminDb();
  const { data: payment, error } = await db
    .from("shopper_payments")
    .select("id, purchase_id, amount_mxn_cents, voided_at")
    .eq("id", input.paymentId)
    .maybeSingle();
  if (error) return fail(describePurchaseError(new Error(error.message), "No fue posible leer el abono."));
  if (!payment) return fail("Abono no encontrado.");
  if (payment.voided_at) return fail("Este abono ya está anulado.");

  const { data, error: updateError } = await db
    .from("shopper_payments")
    .update({ voided_at: new Date().toISOString(), void_reason: reason, voided_by_admin_id: input.adminId })
    .eq("id", input.paymentId)
    .is("voided_at", null)
    .select("id");
  if (updateError) return fail(describePurchaseError(new Error(updateError.message), "No fue posible anular el abono."));
  if (!data?.length) return fail("Este abono ya está anulado.");

  await logActivity({
    adminUserId: input.adminId,
    action: "SHOPPER_PAYMENT_VOIDED",
    entityType: "shopper_payments",
    entityId: input.paymentId,
    previousData: { amount_mxn_cents: num(payment.amount_mxn_cents) },
    newData: { reason },
  });
  return { ok: true, purchaseId: (payment.purchase_id as string | null) ?? null };
}
