import { businessToday } from "../format";
import { adminDb } from "./business";

// ---------------------------------------------------------------------------
// Cotizaciones = the `quotes` / `quote_items` tables added by
// database/migrations/007_quotes.sql. A quote is a budget sent to a client
// BEFORE anything is committed: no ticket, no inventory movement, no money.
// Converting one is what produces a real pedido (orders, via
// createManualOrderAction) or a real venta (sales, see app/admin/cotizaciones/actions.ts).
// Until migration 007 has been applied every read here reports `unavailable`
// instead of throwing, the same way admin-commerce.ts degrades before 002.
// ---------------------------------------------------------------------------

export type QuoteStatus = "DRAFT" | "SENT" | "CONVERTED" | "CANCELLED";

export const QUOTE_STATUSES: QuoteStatus[] = ["DRAFT", "SENT", "CONVERTED", "CANCELLED"];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  CONVERTED: "Convertida",
  CANCELLED: "Cancelada",
};

export const QUOTE_STATUS_TONES: Record<QuoteStatus, "neutral" | "rose" | "success" | "warning" | "danger"> = {
  DRAFT: "warning",
  SENT: "rose",
  CONVERTED: "success",
  CANCELLED: "danger",
};

/**
 * "Vencida" is derived, never stored: there is no cron and no EXPIRED status.
 * A quote is expired when its validity date has passed while it is still open
 * (DRAFT/SENT) — once it is converted or cancelled the date stops mattering.
 */
export function isQuoteExpired(status: QuoteStatus, validUntil: string, today = businessToday()) {
  if (status !== "DRAFT" && status !== "SENT") return false;
  return validUntil < today;
}

export type QuoteListRow = {
  id: string;
  status: QuoteStatus;
  valid_until: string;
  created_at: string;
  sent_at: string | null;
  converted_at: string | null;
  client: { id: string; first_name: string; last_name: string; phone: string } | null;
  itemCount: number;
  totalCents: number;
};

export type QuoteItemRow = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit_price_cents: number;
  productName: string | null;
  variantName: string | null;
  catalogType: "ON_DEMAND" | "IMMEDIATE" | null;
  /** Current catalogue price, so the detail screen can flag a quote that drifted. */
  currentPriceCents: number | null;
  /** Carried into sale_items.unit_cost_cents when a quote is sold, like createSaleAction does. */
  costCents: number;
  productActive: boolean;
  variantActive: boolean;
};

const QUOTE_PAGE_SIZE = 20;

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** The panel must say "apply migration 007" rather than render an empty list as if there were no quotes. */
function isMissingTable(message: string) {
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("Could not find the")
  );
}

export const QUOTES_UNAVAILABLE_MESSAGE =
  "No fue posible leer las cotizaciones. Aplica database/migrations/007_quotes.sql en el editor SQL de Supabase.";

export type ListQuotesResult = {
  quotes: QuoteListRow[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
  unavailable: boolean;
};

export async function listQuotes(query: { search?: string; status?: string; page?: number } = {}): Promise<ListQuotesResult> {
  const page = Math.max(1, query.page ?? 1);
  const from = (page - 1) * QUOTE_PAGE_SIZE;
  const db = adminDb();
  const empty = { quotes: [] as QuoteListRow[], page, pageSize: QUOTE_PAGE_SIZE, total: 0, hasNextPage: false };

  let clientIds: string[] | null = null;
  if (query.search?.trim()) {
    const term = `%${query.search.trim()}%`;
    const { data, error } = await db
      .from("clients")
      .select("id")
      .or(`first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term}`);
    if (error) throw new Error(error.message);
    clientIds = (data ?? []).map((row) => row.id as string);
    if (!clientIds.length) return { ...empty, unavailable: false };
  }

  let builder = db
    .from("quotes")
    .select(
      "id, status, valid_until, created_at, sent_at, converted_at, clients(id, first_name, last_name, phone), quote_items(quantity, unit_price_cents)",
      { count: "exact" },
    );

  if (query.status && QUOTE_STATUSES.includes(query.status as QuoteStatus)) {
    builder = builder.eq("status", query.status);
  }
  if (clientIds) builder = builder.in("client_id", clientIds);

  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + QUOTE_PAGE_SIZE - 1);
  if (error) {
    if (isMissingTable(error.message)) return { ...empty, unavailable: true };
    throw new Error(error.message);
  }

  const quotes: QuoteListRow[] = (data ?? []).map((row) => {
    const items = (row.quote_items ?? []) as Array<{ quantity: number; unit_price_cents: number }>;
    return {
      id: row.id as string,
      status: row.status as QuoteStatus,
      valid_until: row.valid_until as string,
      created_at: row.created_at as string,
      sent_at: row.sent_at as string | null,
      converted_at: row.converted_at as string | null,
      client: relation(row.clients as unknown as QuoteListRow["client"][]),
      itemCount: items.reduce((sum, item) => sum + Number(item.quantity), 0),
      totalCents: items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price_cents), 0),
    };
  });

  return {
    quotes,
    page,
    pageSize: QUOTE_PAGE_SIZE,
    total: count ?? quotes.length,
    hasNextPage: (count ?? 0) > from + QUOTE_PAGE_SIZE,
    unavailable: false,
  };
}

export type QuoteDetail = {
  quote: {
    id: string;
    status: QuoteStatus;
    valid_until: string;
    notes: string | null;
    created_at: string;
    sent_at: string | null;
    converted_at: string | null;
    cancelled_at: string | null;
    converted_order_id: string | null;
    converted_sale_id: string | null;
    client_id: string;
  };
  client: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string | null;
    status: string;
    telegram_chat_id: number | null;
  } | null;
  items: QuoteItemRow[];
  totalCents: number;
  convertedSaleNumber: string | null;
};

export async function getQuoteDetail(id: string): Promise<QuoteDetail | null> {
  const db = adminDb();
  const { data: quote, error } = await db
    .from("quotes")
    .select(
      "id, status, valid_until, notes, created_at, sent_at, converted_at, cancelled_at, converted_order_id, converted_sale_id, client_id, clients(id, first_name, last_name, phone, email, status, telegram_chat_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!quote) return null;

  const { data: items, error: itemsError } = await db
    .from("quote_items")
    .select(
      "id, product_id, variant_id, quantity, unit_price_cents, products(name, catalog_type, is_active), product_variants(name, price_cents, cost_cents, is_active)",
    )
    .eq("quote_id", id)
    .order("created_at", { ascending: true });
  if (itemsError) throw new Error(itemsError.message);

  const quoteItems: QuoteItemRow[] = (items ?? []).map((row) => {
    const product = relation(row.products as unknown as Array<{ name: string; catalog_type: string; is_active: boolean }>);
    const variant = relation(
      row.product_variants as unknown as Array<{ name: string; price_cents: number; cost_cents: number; is_active: boolean }>,
    );
    return {
      id: row.id as string,
      product_id: row.product_id as string | null,
      variant_id: row.variant_id as string | null,
      quantity: Number(row.quantity),
      unit_price_cents: Number(row.unit_price_cents),
      productName: product?.name ?? null,
      variantName: variant?.name ?? null,
      catalogType: (product?.catalog_type as QuoteItemRow["catalogType"]) ?? null,
      currentPriceCents: variant ? Number(variant.price_cents) : null,
      costCents: variant ? Number(variant.cost_cents ?? 0) : 0,
      productActive: product?.is_active ?? false,
      variantActive: variant?.is_active ?? false,
    };
  });

  // sale_number is the folio the owner recognises; a pedido has no folio column
  // (the panel shows the first 8 characters of its id, like /admin/pedidos does).
  let convertedSaleNumber: string | null = null;
  if (quote.converted_sale_id) {
    const { data: sale } = await db
      .from("sales")
      .select("sale_number")
      .eq("id", quote.converted_sale_id as string)
      .maybeSingle();
    convertedSaleNumber = (sale?.sale_number as string | null) ?? null;
  }

  return {
    quote: {
      id: quote.id as string,
      status: quote.status as QuoteStatus,
      valid_until: quote.valid_until as string,
      notes: quote.notes as string | null,
      created_at: quote.created_at as string,
      sent_at: quote.sent_at as string | null,
      converted_at: quote.converted_at as string | null,
      cancelled_at: quote.cancelled_at as string | null,
      converted_order_id: quote.converted_order_id as string | null,
      converted_sale_id: quote.converted_sale_id as string | null,
      client_id: quote.client_id as string,
    },
    client: relation(quote.clients as unknown as QuoteDetail["client"][]),
    items: quoteItems,
    totalCents: quoteItems.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0),
    convertedSaleNumber,
  };
}

export type ClientQuoteRow = {
  id: string;
  status: QuoteStatus;
  valid_until: string;
  created_at: string;
  itemCount: number;
  totalCents: number;
};

/**
 * Short list for the client file (app/admin/clientes/[id]). Never throws: a
 * client card must still render before migration 007 has been applied, so the
 * caller gets `unavailable` and shows a notice instead of a broken page.
 */
export async function listQuotesForClient(clientId: string, limit = 10): Promise<{ quotes: ClientQuoteRow[]; unavailable: boolean }> {
  const { data, error } = await adminDb()
    .from("quotes")
    .select("id, status, valid_until, created_at, quote_items(quantity, unit_price_cents)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { quotes: [], unavailable: true };

  return {
    quotes: (data ?? []).map((row) => {
      const items = (row.quote_items ?? []) as Array<{ quantity: number; unit_price_cents: number }>;
      return {
        id: row.id as string,
        status: row.status as QuoteStatus,
        valid_until: row.valid_until as string,
        created_at: row.created_at as string,
        itemCount: items.reduce((sum, item) => sum + Number(item.quantity), 0),
        totalCents: items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price_cents), 0),
      };
    }),
    unavailable: false,
  };
}
