import { accumulatePurchases, type ClientMetrics, type PurchaseEvent } from "./admin-contacts";
import { adminDb, DEFAULT_BUSINESS_ID } from "./business";

/**
 * Estadísticas (Fase 3). One aggregation over the two revenue streams the
 * business actually has:
 *
 *   tickets  the catalogue business. A ticket is created 1:1 from an order_item
 *            (tickets.order_item_id is UNIQUE) and carries the agreed total, the
 *            product/category snapshots and its own cancellation state, so it -
 *            not order_items - is the row that represents committed revenue.
 *            Counting order_items *and* tickets would double every catalogue
 *            sale, which is why the public catalogue's rankByBestsellers
 *            (lib/supabase/catalog.ts) is deliberately NOT reused here: it ranks
 *            order_items + sale_items by units with no date range, no money and
 *            no cancellation filter - fine for "Más vendidos" on the storefront,
 *            wrong for a P&L screen.
 *   sales    direct counter sales (migration 002). Already the source of truth
 *            for Balance; here they contribute revenue, cost (sale_items carries
 *            a unit_cost_cents snapshot) and per-client totals.
 *
 * Revenue and per-client totals use exactly the same definition as the client
 * card (getClientMetrics): completed sales + non-cancelled tickets. The shared
 * accumulator lives in admin-contacts.ts so there is a single rule.
 */

export type StatsRange = { from: string; to: string };

const BUSINESS_TZ = "America/Mazatlan";

/** Tickets in these states were undone; they are not revenue. */
const CANCELLED_TICKET_STATES = ["CANCELLED_INCIDENT", "REFUNDED"] as const;

/**
 * `.in(...)` travels in the query string, so batching keeps the URL well under
 * the edge's limit - same reason and same size as getStockFor in admin-catalog.
 */
const ID_BATCH_SIZE = 150;

const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ });

/** Minutes the business timezone is offset from UTC at that instant. */
function businessOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60000;
}

/**
 * The instant 00:00 business-local starts on that calendar day. Ranges are
 * picked as local days, so filtering on a naive `${day}T00:00:00` would shift
 * every boundary by the timezone offset and move sales into the wrong day.
 */
export function businessDayStart(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const naive = Date.UTC(year, (month ?? 1) - 1, date ?? 1, 0, 0, 0);
  return new Date(naive - businessOffsetMinutes(new Date(naive)) * 60000);
}

/** Business-local calendar day (YYYY-MM-DD) a timestamp belongs to. */
export function businessDayOf(value: string) {
  return DAY_KEY.format(new Date(value));
}

/** Calendar day as a UTC midnight instant, for day arithmetic only. */
function dayIndex(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, date ?? 1);
}

export function shiftDay(day: string, days: number) {
  return new Date(dayIndex(day) + days * 86400000).toISOString().slice(0, 10);
}

export function dayCountOf(range: StatsRange) {
  return Math.max(1, Math.round((dayIndex(range.to) - dayIndex(range.from)) / 86400000) + 1);
}

/** Every calendar day in the range, inclusive. */
export function daysBetween(range: StatsRange) {
  const days: string[] = [];
  const total = dayCountOf(range);
  for (let index = 0; index < total; index += 1) days.push(shiftDay(range.from, index));
  return days;
}

/**
 * The comparison window is the same number of days immediately before the
 * range, so "esta semana" is compared against the 7 days before it rather than
 * against a calendar month of different length.
 */
export function previousRange(range: StatsRange): StatsRange {
  const days = dayCountOf(range);
  return { from: shiftDay(range.from, -days), to: shiftDay(range.from, -1) };
}

export type SoldLine = {
  source: "TICKET" | "SALE";
  day: string;
  productId: string | null;
  productName: string;
  categoryName: string | null;
  quantity: number;
  revenueCents: number;
  costCents: number;
  /** No cost was ever registered for this product, so its margin is overstated. */
  costMissing: boolean;
};

export type PeriodTotals = {
  range: StatsRange;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  /** null when there is no revenue to divide by. */
  marginPercent: number | null;
  /** Tickets + completed direct sales. */
  saleCount: number;
  unitCount: number;
  averageSaleCents: number;
  /** Revenue with no product behind it (ventas libres), excluded from the rankings. */
  freeSaleRevenueCents: number;
  lines: SoldLine[];
  purchases: PurchaseEvent[];
  byDay: Map<string, { revenueCents: number; saleCount: number }>;
  linesMissingCost: number;
  /** migration 002 not applied: direct sales could not be read. */
  salesUnavailable: boolean;
};

const EMPTY_TOTALS = (range: StatsRange): PeriodTotals => ({
  range,
  revenueCents: 0,
  costCents: 0,
  marginCents: 0,
  marginPercent: null,
  saleCount: 0,
  unitCount: 0,
  averageSaleCents: 0,
  freeSaleRevenueCents: 0,
  lines: [],
  purchases: [],
  byDay: new Map(),
  linesMissingCost: 0,
  salesUnavailable: false,
});

type SaleRow = {
  id: string;
  client_id: string | null;
  sale_type: "PRODUCT" | "FREE";
  concept: string | null;
  total_cents: number;
  sold_at: string;
};

type SaleItemRow = {
  sale_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  quantity: number;
  unit_cost_cents: number;
  total_cents: number;
  products: { category_id: string | null; categories: { name: string } | Array<{ name: string }> | null } | null;
};

type TicketRow = {
  client_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name_snapshot: string;
  category_name_snapshot: string | null;
  quantity: number;
  agreed_total_cents: number;
  created_at: string;
};

function relationName(value: { name: string } | Array<{ name: string }> | null | undefined) {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? null;
}

/** cost_cents per variant, batched so the request URL stays short. */
async function getVariantCosts(variantIds: string[]) {
  const costs = new Map<string, number>();
  const unique = [...new Set(variantIds)];
  if (!unique.length) return costs;
  const db = adminDb();
  for (let index = 0; index < unique.length; index += ID_BATCH_SIZE) {
    const batch = unique.slice(index, index + ID_BATCH_SIZE);
    const { data, error } = await db.from("product_variants").select("id, cost_cents").in("id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) costs.set(row.id as string, Number(row.cost_cents ?? 0));
  }
  return costs;
}

/**
 * Every sold line in the window, priced and costed. Throws only on a real query
 * failure; an empty window is a perfectly valid (and, today, the expected)
 * answer.
 */
export async function getPeriodTotals(range: StatsRange): Promise<PeriodTotals> {
  const db = adminDb();
  const fromIso = businessDayStart(range.from).toISOString();
  const toIso = businessDayStart(shiftDay(range.to, 1)).toISOString();

  const [sales, tickets] = await Promise.all([
    db
      .from("sales")
      .select("id, client_id, sale_type, concept, total_cents, sold_at")
      .eq("business_id", DEFAULT_BUSINESS_ID)
      .eq("status", "COMPLETED")
      .gte("sold_at", fromIso)
      .lt("sold_at", toIso),
    db
      .from("tickets")
      .select(
        "client_id, product_id, variant_id, product_name_snapshot, category_name_snapshot, quantity, agreed_total_cents, created_at",
      )
      .not("financial_status", "in", `(${CANCELLED_TICKET_STATES.join(",")})`)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
  ]);

  // tickets lives in the base schema and must always answer. sales/sale_items
  // arrive with migration 002, so - like the client card does - a missing table
  // degrades to "no direct sales" instead of blanking the whole screen.
  if (tickets.error) throw new Error(tickets.error.message);

  const saleRows = (sales.data ?? []) as SaleRow[];
  const ticketRows = (tickets.data ?? []) as TicketRow[];

  let saleItemRows: SaleItemRow[] = [];
  if (saleRows.length) {
    const ids = saleRows.map((sale) => sale.id);
    for (let index = 0; index < ids.length; index += ID_BATCH_SIZE) {
      const batch = ids.slice(index, index + ID_BATCH_SIZE);
      const { data, error } = await db
        .from("sale_items")
        .select(
          "sale_id, product_id, product_name_snapshot, quantity, unit_cost_cents, total_cents, products(category_id, categories(name))",
        )
        .in("sale_id", batch);
      if (error) throw new Error(error.message);
      saleItemRows = saleItemRows.concat((data ?? []) as unknown as SaleItemRow[]);
    }
  }

  const itemsBySale = new Map<string, SaleItemRow[]>();
  for (const item of saleItemRows) {
    const bucket = itemsBySale.get(item.sale_id);
    if (bucket) bucket.push(item);
    else itemsBySale.set(item.sale_id, [item]);
  }

  const ticketCosts = await getVariantCosts(
    ticketRows.flatMap((ticket) => (ticket.variant_id ? [ticket.variant_id] : [])),
  );

  const totals = EMPTY_TOTALS(range);
  totals.salesUnavailable = Boolean(sales.error);

  const addDay = (day: string, revenueCents: number) => {
    const current = totals.byDay.get(day) ?? { revenueCents: 0, saleCount: 0 };
    current.revenueCents += revenueCents;
    current.saleCount += 1;
    totals.byDay.set(day, current);
  };

  for (const sale of saleRows) {
    const revenue = Number(sale.total_cents ?? 0);
    const day = businessDayOf(sale.sold_at);
    totals.revenueCents += revenue;
    totals.saleCount += 1;
    addDay(day, revenue);
    if (sale.client_id) totals.purchases.push({ clientId: sale.client_id, cents: revenue, at: sale.sold_at });

    const items = itemsBySale.get(sale.id) ?? [];
    if (!items.length) {
      totals.freeSaleRevenueCents += revenue;
      continue;
    }
    // A whole-sale discount lives on sales.total_cents, not on the items, so the
    // line revenues are scaled to add up to what the client actually paid -
    // otherwise the product ranking would sum to more than the period's sales.
    const itemsTotal = items.reduce((sum, item) => sum + Number(item.total_cents ?? 0), 0);
    const factor = itemsTotal > 0 ? revenue / itemsTotal : 0;
    for (const item of items) {
      const quantity = Number(item.quantity ?? 0);
      const cost = Math.round(Number(item.unit_cost_cents ?? 0) * quantity);
      const costMissing = Number(item.unit_cost_cents ?? 0) <= 0;
      totals.costCents += cost;
      totals.unitCount += quantity;
      if (costMissing) totals.linesMissingCost += 1;
      totals.lines.push({
        source: "SALE",
        day,
        productId: item.product_id,
        productName: item.product_name_snapshot,
        categoryName: relationName(item.products?.categories),
        quantity,
        revenueCents: Math.round(Number(item.total_cents ?? 0) * factor),
        costCents: cost,
        costMissing,
      });
    }
  }

  for (const ticket of ticketRows) {
    const revenue = Number(ticket.agreed_total_cents ?? 0);
    const quantity = Number(ticket.quantity ?? 0);
    const day = businessDayOf(ticket.created_at);
    // Tickets carry no cost snapshot, so the product's current cost is the best
    // available figure. The screen says so rather than pretending it is exact.
    const unitCost = ticket.variant_id ? (ticketCosts.get(ticket.variant_id) ?? 0) : 0;
    const cost = Math.round(unitCost * quantity);
    const costMissing = unitCost <= 0;

    totals.revenueCents += revenue;
    totals.costCents += cost;
    totals.saleCount += 1;
    totals.unitCount += quantity;
    if (costMissing) totals.linesMissingCost += 1;
    addDay(day, revenue);
    totals.purchases.push({ clientId: ticket.client_id, cents: revenue, at: ticket.created_at });
    totals.lines.push({
      source: "TICKET",
      day,
      productId: ticket.product_id,
      productName: ticket.product_name_snapshot,
      categoryName: ticket.category_name_snapshot,
      quantity,
      revenueCents: revenue,
      costCents: cost,
      costMissing,
    });
  }

  totals.marginCents = totals.revenueCents - totals.costCents;
  totals.marginPercent = totals.revenueCents > 0 ? (totals.marginCents / totals.revenueCents) * 100 : null;
  totals.averageSaleCents = totals.saleCount > 0 ? Math.round(totals.revenueCents / totals.saleCount) : 0;
  return totals;
}

export type RankedProduct = {
  key: string;
  name: string;
  categoryName: string | null;
  quantity: number;
  revenueCents: number;
  marginCents: number;
  costMissing: boolean;
};

export function rankProducts(totals: PeriodTotals, limit = 10): RankedProduct[] {
  const byProduct = new Map<string, RankedProduct>();
  for (const line of totals.lines) {
    // A deleted product leaves product_id NULL but keeps its name snapshot, so
    // the name is the fallback key instead of dropping the sale from the rank.
    const key = line.productId ?? `name:${line.productName}`;
    const current = byProduct.get(key) ?? {
      key,
      name: line.productName,
      categoryName: line.categoryName,
      quantity: 0,
      revenueCents: 0,
      marginCents: 0,
      costMissing: false,
    };
    current.quantity += line.quantity;
    current.revenueCents += line.revenueCents;
    current.marginCents += line.revenueCents - line.costCents;
    current.costMissing = current.costMissing || line.costMissing;
    if (!current.categoryName && line.categoryName) current.categoryName = line.categoryName;
    byProduct.set(key, current);
  }
  return [...byProduct.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenueCents - a.revenueCents)
    .slice(0, limit);
}

export type RankedCategory = {
  name: string;
  quantity: number;
  revenueCents: number;
  marginCents: number;
};

export function rankCategories(totals: PeriodTotals, limit = 8): RankedCategory[] {
  const byCategory = new Map<string, RankedCategory>();
  for (const line of totals.lines) {
    const name = line.categoryName ?? "Sin categoría";
    const current = byCategory.get(name) ?? { name, quantity: 0, revenueCents: 0, marginCents: 0 };
    current.quantity += line.quantity;
    current.revenueCents += line.revenueCents;
    current.marginCents += line.revenueCents - line.costCents;
    byCategory.set(name, current);
  }
  return [...byCategory.values()]
    .sort((a, b) => b.revenueCents - a.revenueCents || b.quantity - a.quantity)
    .slice(0, limit);
}

export type RankedClient = ClientMetrics & { id: string; name: string; phone: string | null };

/**
 * Reuses the client card's own purchase accumulator, so "total comprado" here
 * and on /admin/clientes/[id] can never drift apart.
 */
export async function rankClients(totals: PeriodTotals, limit = 8): Promise<RankedClient[]> {
  const metrics = accumulatePurchases(totals.purchases);
  if (!metrics.size) return [];

  const ranked = [...metrics.entries()]
    .sort((a, b) => b[1].totalCents - a[1].totalCents || b[1].purchaseCount - a[1].purchaseCount)
    .slice(0, limit);

  const { data, error } = await adminDb()
    .from("clients")
    .select("id, first_name, last_name, phone")
    .in("id", ranked.map(([id]) => id));
  if (error) throw new Error(error.message);

  const names = new Map(
    (data ?? []).map((row) => [
      row.id as string,
      { name: `${row.first_name} ${row.last_name}`.trim(), phone: row.phone as string | null },
    ]),
  );

  return ranked.map(([id, value]) => ({
    id,
    name: names.get(id)?.name ?? "Clienta",
    phone: names.get(id)?.phone ?? null,
    ...value,
  }));
}

export type DailyPoint = { day: string; revenueCents: number; saleCount: number };

export function dailySeries(totals: PeriodTotals): DailyPoint[] {
  // Every day in the range is emitted, including the ones with no sales: a gap
  // in the chart is information, a missing bar is a lie about the shape.
  return daysBetween(totals.range).map((day) => ({
    day,
    revenueCents: totals.byDay.get(day)?.revenueCents ?? 0,
    saleCount: totals.byDay.get(day)?.saleCount ?? 0,
  }));
}

export type Comparison = { changePercent: number | null; direction: "up" | "down" | "flat" };

/** Percentage change against the previous window. null when it had no revenue. */
export function compare(current: number, previous: number): Comparison {
  if (previous === 0) return { changePercent: null, direction: current > 0 ? "up" : "flat" };
  const changePercent = ((current - previous) / previous) * 100;
  const direction = Math.abs(changePercent) < 0.05 ? "flat" : changePercent > 0 ? "up" : "down";
  return { changePercent, direction };
}

export type StatsData = {
  current: PeriodTotals;
  previous: PeriodTotals;
  products: RankedProduct[];
  categories: RankedCategory[];
  clients: RankedClient[];
  daily: DailyPoint[];
};

export async function getStats(range: StatsRange): Promise<StatsData> {
  const [current, previous] = await Promise.all([
    getPeriodTotals(range),
    getPeriodTotals(previousRange(range)),
  ]);
  return {
    current,
    previous,
    products: rankProducts(current),
    categories: rankCategories(current),
    clients: await rankClients(current),
    daily: dailySeries(current),
  };
}
