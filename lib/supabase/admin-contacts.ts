import { listQuotesForClient } from "./admin-quotes";
import { adminDb, DEFAULT_BUSINESS_ID } from "./business";

// ---------------------------------------------------------------------------
// Clients. The existing `clients` table is the customer table for the whole
// product: it is bound to auth.users, carries RLS policies and is what tickets,
// orders and deliveries point at. No parallel "customers" table is introduced.
// ---------------------------------------------------------------------------

export type ClientRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  instagram: string | null;
  address: string | null;
  internal_notes: string | null;
  payment_plans_allowed: boolean;
  credit_balance_cents: number;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  created_at: string;
};

export type ClientMetrics = {
  purchaseCount: number;
  totalCents: number;
  lastPurchaseAt: string | null;
};

const CLIENT_PAGE_SIZE = 20;

export async function listClients(query: { search?: string; page?: number; includeArchived?: boolean } = {}) {
  const page = Math.max(1, query.page ?? 1);
  const from = (page - 1) * CLIENT_PAGE_SIZE;
  let builder = adminDb()
    .from("clients")
    .select(
      "id, first_name, last_name, phone, email, instagram, address, internal_notes, payment_plans_allowed, credit_balance_cents, status, created_at",
      { count: "exact" },
    );

  if (!query.includeArchived) builder = builder.eq("status", "ACTIVE");
  if (query.search) {
    const term = `%${query.search}%`;
    builder = builder.or(
      `first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term},email.ilike.${term},instagram.ilike.${term}`,
    );
  }

  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + CLIENT_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  const clients = (data ?? []) as ClientRow[];
  const metrics = await getClientMetrics(clients.map((client) => client.id));

  return {
    clients,
    metrics,
    page,
    pageSize: CLIENT_PAGE_SIZE,
    total: count ?? clients.length,
    hasNextPage: (count ?? 0) > from + CLIENT_PAGE_SIZE,
  };
}

/** One purchase attributed to one client: a ticket or a completed direct sale. */
export type PurchaseEvent = { clientId: string; cents: number; at: string };

/**
 * The single definition of "what this client has bought". Kept as a pure
 * function so the client card (which queries a client's whole history) and
 * Estadísticas (which already holds a period's rows in memory) rank clients by
 * exactly the same rule instead of each writing its own sum.
 */
export function accumulatePurchases(events: PurchaseEvent[]): Map<string, ClientMetrics> {
  const result = new Map<string, ClientMetrics>();
  for (const event of events) {
    const current = result.get(event.clientId) ?? { purchaseCount: 0, totalCents: 0, lastPurchaseAt: null };
    current.purchaseCount += 1;
    current.totalCents += event.cents;
    if (!current.lastPurchaseAt || event.at > current.lastPurchaseAt) current.lastPurchaseAt = event.at;
    result.set(event.clientId, current);
  }
  return result;
}

/**
 * Purchase totals combine BOTH revenue streams: catalogue tickets (the payment
 * plan business) and the new direct sales, so the number matches what the owner
 * would count by hand.
 */
export async function getClientMetrics(clientIds: string[]): Promise<Map<string, ClientMetrics>> {
  if (!clientIds.length) return new Map<string, ClientMetrics>();
  const db = adminDb();

  const [tickets, sales] = await Promise.all([
    db.from("tickets").select("client_id, agreed_total_cents, created_at").in("client_id", clientIds),
    db.from("sales").select("client_id, total_cents, sold_at, status").in("client_id", clientIds),
  ]);
  if (tickets.error) throw new Error(tickets.error.message);

  const events: PurchaseEvent[] = (tickets.data ?? []).map((ticket) => ({
    clientId: ticket.client_id as string,
    cents: Number(ticket.agreed_total_cents ?? 0),
    at: String(ticket.created_at),
  }));
  // sales may not exist yet if migration 002 has not been applied; that is not fatal.
  if (!sales.error) {
    for (const sale of sales.data ?? []) {
      if (!sale.client_id || sale.status !== "COMPLETED") continue;
      events.push({ clientId: sale.client_id as string, cents: Number(sale.total_cents ?? 0), at: String(sale.sold_at) });
    }
  }
  return accumulatePurchases(events);
}

export async function getClientDetail(id: string) {
  const db = adminDb();
  const { data, error } = await db
    .from("clients")
    .select(
      "id, first_name, last_name, phone, email, instagram, address, birth_date, internal_notes, payment_plans_allowed, credit_balance_cents, status, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const [tickets, sales, metrics, quotes] = await Promise.all([
    db
      .from("tickets")
      .select("id, ticket_number, product_name_snapshot, agreed_total_cents, payment_mode, financial_status, logistics_status, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
    db
      .from("sales")
      .select("id, sale_number, sale_type, concept, total_cents, payment_method, status, sold_at")
      .eq("client_id", id)
      .order("sold_at", { ascending: false })
      .limit(25),
    getClientMetrics([id]),
    // Quotes are budgets, not purchases: they are listed on the card but never
    // counted in the metrics above, and they degrade to `unavailable` on their
    // own before migration 007 has been applied.
    listQuotesForClient(id),
  ]);
  if (tickets.error) throw new Error(tickets.error.message);

  return {
    client: data as ClientRow & { birth_date: string | null },
    tickets: tickets.data ?? [],
    sales: sales.error ? [] : (sales.data ?? []),
    salesUnavailable: Boolean(sales.error),
    quotes: quotes.quotes,
    quotesUnavailable: quotes.unavailable,
    metrics: metrics.get(id) ?? { purchaseCount: 0, totalCents: 0, lastPurchaseAt: null },
  };
}

/** Lightweight list for the "assign a client" pickers (POS, expenses). */
export async function listClientOptions(limit = 300) {
  const { data, error } = await adminDb()
    .from("clients")
    .select("id, first_name, last_name, phone")
    .eq("status", "ACTIVE")
    .order("first_name")
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((client) => ({
    id: client.id as string,
    label: `${client.first_name} ${client.last_name}`.trim(),
    phone: client.phone as string,
  }));
}

// ---------------------------------------------------------------------------
// Suppliers. New concept: `brands` describes which luxury house made a product,
// which is not the same as a vendor the business buys from and books expenses
// against.
// ---------------------------------------------------------------------------

export type SupplierRow = {
  id: string;
  business_id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

const SUPPLIER_PAGE_SIZE = 20;

export async function listSuppliers(query: { search?: string; page?: number; includeArchived?: boolean } = {}) {
  const page = Math.max(1, query.page ?? 1);
  const from = (page - 1) * SUPPLIER_PAGE_SIZE;
  let builder = adminDb()
    .from("suppliers")
    .select("id, business_id, name, company, phone, email, address, notes, is_active, created_at", { count: "exact" })
    .eq("business_id", DEFAULT_BUSINESS_ID);

  if (!query.includeArchived) builder = builder.eq("is_active", true);
  if (query.search) {
    const term = `%${query.search}%`;
    builder = builder.or(`name.ilike.${term},company.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
  }

  const { data, error, count } = await builder.order("name").range(from, from + SUPPLIER_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  const suppliers = (data ?? []) as SupplierRow[];
  const spend = await getSupplierSpend(suppliers.map((supplier) => supplier.id));

  return {
    suppliers,
    spend,
    page,
    pageSize: SUPPLIER_PAGE_SIZE,
    total: count ?? suppliers.length,
    hasNextPage: (count ?? 0) > from + SUPPLIER_PAGE_SIZE,
  };
}

export async function getSupplierSpend(supplierIds: string[]) {
  const result = new Map<string, { expenseCount: number; totalCents: number }>();
  if (!supplierIds.length) return result;
  const { data, error } = await adminDb()
    .from("expenses")
    .select("supplier_id, amount_cents")
    .in("supplier_id", supplierIds);
  if (error) return result;
  for (const expense of data ?? []) {
    const key = expense.supplier_id as string;
    const current = result.get(key) ?? { expenseCount: 0, totalCents: 0 };
    current.expenseCount += 1;
    current.totalCents += Number(expense.amount_cents ?? 0);
    result.set(key, current);
  }
  return result;
}

export async function listSupplierOptions(limit = 200) {
  const { data, error } = await adminDb()
    .from("suppliers")
    .select("id, name, company")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .eq("is_active", true)
    .order("name")
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((supplier) => ({
    id: supplier.id as string,
    label: supplier.company ? `${supplier.name} · ${supplier.company}` : (supplier.name as string),
  }));
}
