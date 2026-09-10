import { adminDb, DEFAULT_BUSINESS_ID } from "./business";

// ---------------------------------------------------------------------------
// Cash sessions (drawer). Minimal but real: opening amount, closing amount and
// the expected amount derived from the cash movements recorded while it was open.
// ---------------------------------------------------------------------------

export type CashSessionRow = {
  id: string;
  status: "OPEN" | "CLOSED";
  opening_amount_cents: number;
  closing_amount_cents: number | null;
  expected_amount_cents: number | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  opened_by_admin_id: string | null;
  closed_by_admin_id: string | null;
};

export async function getOpenCashSession(): Promise<CashSessionRow | null> {
  const { data, error } = await adminDb()
    .from("cash_sessions")
    .select("id, status, opening_amount_cents, closing_amount_cents, expected_amount_cents, opened_at, closed_at, notes, opened_by_admin_id, closed_by_admin_id")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .eq("status", "OPEN")
    .maybeSingle();
  if (error) return null;
  return (data as CashSessionRow | null) ?? null;
}

export async function listCashSessions(limit = 30) {
  const { data, error } = await adminDb()
    .from("cash_sessions")
    .select("id, status, opening_amount_cents, closing_amount_cents, expected_amount_cents, opened_at, closed_at, notes, opened_by_admin_id, closed_by_admin_id")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) return { sessions: [] as CashSessionRow[], unavailable: true };
  return { sessions: (data ?? []) as CashSessionRow[], unavailable: false };
}

/** Cash in the drawer = opening float + cash sales - cash expenses since it opened. */
export async function computeExpectedCash(sessionId: string, openingAmountCents: number) {
  const db = adminDb();
  const [sales, expenses] = await Promise.all([
    db.from("sales").select("total_cents, payment_method, status").eq("cash_session_id", sessionId),
    db.from("expenses").select("amount_cents, payment_method").eq("cash_session_id", sessionId),
  ]);
  let expected = openingAmountCents;
  for (const sale of sales.data ?? []) {
    if (sale.status === "COMPLETED" && sale.payment_method === "CASH") expected += Number(sale.total_cents ?? 0);
  }
  for (const expense of expenses.data ?? []) {
    if (expense.payment_method === "CASH") expected -= Number(expense.amount_cents ?? 0);
  }
  return expected;
}

// ---------------------------------------------------------------------------
// Balance: one unified ledger over direct sales and expenses.
// ---------------------------------------------------------------------------

export type BalanceRange = { from: string; to: string };

export type Transaction = {
  id: string;
  kind: "SALE" | "FREE_SALE" | "EXPENSE";
  reference: string;
  date: string;
  concept: string;
  counterparty: string;
  employee: string;
  amountCents: number;
  direction: "IN" | "OUT";
  paymentMethod: string;
  status: string;
};

function endOfDayIso(day: string) {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export async function getBalance(range: BalanceRange) {
  const db = adminDb();
  const fromIso = new Date(`${range.from}T00:00:00`).toISOString();
  const toIso = endOfDayIso(range.to);

  const [sales, expenses, admins, clients, suppliers] = await Promise.all([
    db
      .from("sales")
      .select("id, sale_number, sale_type, status, concept, total_cents, payment_method, sold_at, client_id, created_by_admin_id, notes")
      .eq("business_id", DEFAULT_BUSINESS_ID)
      .gte("sold_at", fromIso)
      .lt("sold_at", toIso)
      .order("sold_at", { ascending: false }),
    db
      .from("expenses")
      .select("id, concept, category, amount_cents, payment_method, expense_date, supplier_id, created_by_admin_id, created_at")
      .eq("business_id", DEFAULT_BUSINESS_ID)
      .gte("expense_date", range.from)
      .lte("expense_date", range.to)
      .order("expense_date", { ascending: false }),
    db.from("admin_users").select("id, display_name"),
    db.from("clients").select("id, first_name, last_name"),
    db.from("suppliers").select("id, name"),
  ]);

  // Migration 002 not applied yet: report it instead of rendering a fake zero.
  if (sales.error || expenses.error) {
    return {
      unavailable: true as const,
      message: "No fue posible leer ventas y gastos. Aplica database/migrations/002_business_management.sql en Supabase.",
      transactions: [] as Transaction[],
      salesTotalCents: 0,
      expensesTotalCents: 0,
      balanceCents: 0,
      saleCount: 0,
      expenseCount: 0,
    };
  }

  const adminNames = new Map((admins.data ?? []).map((row) => [row.id as string, row.display_name as string]));
  const clientNames = new Map(
    (clients.data ?? []).map((row) => [row.id as string, `${row.first_name} ${row.last_name}`.trim()]),
  );
  const supplierNames = new Map((suppliers.data ?? []).map((row) => [row.id as string, row.name as string]));

  const transactions: Transaction[] = [];
  let salesTotalCents = 0;
  let saleCount = 0;

  for (const sale of sales.data ?? []) {
    const amount = Number(sale.total_cents ?? 0);
    if (sale.status === "COMPLETED") {
      salesTotalCents += amount;
      saleCount += 1;
    }
    transactions.push({
      id: sale.id as string,
      kind: sale.sale_type === "FREE" ? "FREE_SALE" : "SALE",
      reference: sale.sale_number as string,
      date: sale.sold_at as string,
      concept: (sale.concept as string | null) ?? "Venta de productos",
      counterparty: sale.client_id ? (clientNames.get(sale.client_id as string) ?? "Cliente") : "Público general",
      employee: adminNames.get(sale.created_by_admin_id as string) ?? "—",
      amountCents: amount,
      direction: "IN",
      paymentMethod: sale.payment_method as string,
      status: sale.status as string,
    });
  }

  let expensesTotalCents = 0;
  for (const expense of expenses.data ?? []) {
    const amount = Number(expense.amount_cents ?? 0);
    expensesTotalCents += amount;
    transactions.push({
      id: expense.id as string,
      kind: "EXPENSE",
      reference: (expense.category as string | null) ?? "Gasto",
      date: (expense.created_at as string) ?? `${expense.expense_date}T12:00:00.000Z`,
      concept: expense.concept as string,
      counterparty: expense.supplier_id ? (supplierNames.get(expense.supplier_id as string) ?? "Proveedor") : "—",
      employee: adminNames.get(expense.created_by_admin_id as string) ?? "—",
      amountCents: amount,
      direction: "OUT",
      paymentMethod: expense.payment_method as string,
      status: "COMPLETED",
    });
  }

  transactions.sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    unavailable: false as const,
    message: null,
    transactions,
    salesTotalCents,
    expensesTotalCents,
    balanceCents: salesTotalCents - expensesTotalCents,
    saleCount,
    expenseCount: (expenses.data ?? []).length,
  };
}

export async function listRecentSales(limit = 10) {
  const { data, error } = await adminDb()
    .from("sales")
    .select("id, sale_number, sale_type, status, concept, total_cents, payment_method, sold_at, client_id")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .order("sold_at", { ascending: false })
    .limit(limit);
  if (error) return { sales: [], unavailable: true as const };
  return { sales: data ?? [], unavailable: false as const };
}
