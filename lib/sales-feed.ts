// Pure rules of the unified "Ventas" list (/admin/vender): which stage a sale
// or a pedido is in, whether it still has money to collect, how it is
// searched and how its payment column reads. Deliberately free of imports so
// the same code runs in the server, in client components and in the PGlite
// checks that compare it against the SQL view `sales_feed` (migración 017).
//
// Keep these rules in sync with database/migrations/017_sales_feed_tracking.sql.

export type SaleKind = "SALE" | "ORDER";

export type SalesStage = "TO_CONFIRM" | "TO_ORDER" | "IN_TRANSIT" | "READY" | "DELIVERED" | "CANCELLED";

export type BadgeTone = "neutral" | "rose" | "success" | "warning" | "danger";

export const STAGE_LABELS: Record<SalesStage, string> = {
  TO_CONFIRM: "Por confirmar",
  TO_ORDER: "Por ordenar",
  IN_TRANSIT: "En camino",
  READY: "Lista para entrega",
  DELIVERED: "Entregada",
  CANCELLED: "Cancelada",
};

export const STAGE_TONES: Record<SalesStage, BadgeTone> = {
  TO_CONFIRM: "warning",
  TO_ORDER: "rose",
  IN_TRANSIT: "rose",
  READY: "success",
  DELIVERED: "neutral",
  CANCELLED: "danger",
};

/** Status chips over the list, in display order. `key` is the ?estado= value. */
export const SALES_FILTERS: Array<{ key: string; label: string; stage?: SalesStage; toCollect?: true }> = [
  { key: "todas", label: "Todas" },
  { key: "por-confirmar", label: "Por confirmar", stage: "TO_CONFIRM" },
  { key: "por-cobrar", label: "Por cobrar", toCollect: true },
  { key: "por-ordenar", label: "Por ordenar", stage: "TO_ORDER" },
  { key: "en-camino", label: "En camino", stage: "IN_TRANSIT" },
  { key: "listas", label: "Listas para entrega", stage: "READY" },
  { key: "entregadas", label: "Entregadas", stage: "DELIVERED" },
  { key: "canceladas", label: "Canceladas", stage: "CANCELLED" },
];

export function resolveSalesFilter(key: string | undefined | null) {
  return SALES_FILTERS.find((filter) => filter.key === key) ?? SALES_FILTERS[0];
}

export type SalesFeedCounts = {
  total: number;
  open: number;
  to_collect: number;
  to_confirm: number;
  to_order: number;
  in_transit: number;
  ready: number;
  delivered: number;
  cancelled: number;
};

export function countForFilter(counts: SalesFeedCounts, key: string) {
  switch (key) {
    case "por-confirmar":
      return counts.to_confirm;
    case "por-cobrar":
      return counts.to_collect;
    case "por-ordenar":
      return counts.to_order;
    case "en-camino":
      return counts.in_transit;
    case "listas":
      return counts.ready;
    case "entregadas":
      return counts.delivered;
    case "canceladas":
      return counts.cancelled;
    default:
      return counts.total;
  }
}

/** One row of the index the list pages over (the SQL view or its in-memory fallback). */
export type SalesFeedIndexRow = {
  kind: SaleKind;
  id: string;
  reference: string;
  occurred_at: string;
  client_id: string | null;
  stage: SalesStage;
  to_collect: boolean;
  search_text: string;
};

// Same character map as translate(...) in the view: lower-case, no accents.
const FOLD_FROM = "áàäâãéèëêíìïîóòöôõúùüûñç";
const FOLD_TO = "aaaaaeeeeiiiiooooouuuunc";

export function foldSearchText(value: string) {
  let out = "";
  for (const char of value.toLowerCase()) {
    const index = FOLD_FROM.indexOf(char);
    out += index >= 0 ? FOLD_TO[index] : char;
  }
  return out;
}

/** Postgres concat_ws: joins the non-null parts (empty strings are kept). */
function concatWs(parts: Array<string | null | undefined>) {
  return parts.filter((part) => part !== null && part !== undefined).join(" ");
}

export function orderReference(orderId: string) {
  return orderId.slice(0, 8).toUpperCase();
}

const LOGISTICS_RANK: Record<string, number> = {
  WAITING_TO_ORDER: 1,
  READY_TO_ORDER: 1,
  ORDERED: 2,
  IN_TRANSIT: 2,
  RECEIVED_LA_PAZ: 2,
  READY_FOR_DELIVERY: 3,
  DELIVERY_SCHEDULED: 3,
  DELIVERED: 4,
};

export type StageTicket = {
  logistics_status: string;
  agreed_total_cents: number | string;
  paid_principal_cents: number | string;
};

function cents(value: number | string): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Importe fuera del rango seguro de centavos.");
  return BigInt(value);
}
function sumCents(values: Array<number | string>) { return values.reduce<bigint>((sum, value) => sum + cents(value), BigInt(0)); }
function safeCents(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Importe fuera del rango seguro de centavos.");
  return number;
}

export function saleStage(status: string): SalesStage {
  return status === "CANCELLED" ? "CANCELLED" : "DELIVERED";
}

/** A pedido is as far along as its least advanced live ticket. */
export function orderStage(status: string, tickets: StageTicket[]): SalesStage {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "DRAFT") return "TO_CONFIRM";
  if (!tickets.length) return status === "COMPLETED" ? "DELIVERED" : "TO_ORDER";
  const active = tickets.filter((ticket) => ticket.logistics_status !== "CANCELLED_INCIDENT");
  if (!active.length) return "CANCELLED";
  const rank = Math.min(...active.map((ticket) => LOGISTICS_RANK[ticket.logistics_status] ?? 4));
  if (rank === 1) return "TO_ORDER";
  if (rank === 2) return "IN_TRANSIT";
  if (rank === 3) return "READY";
  return "DELIVERED";
}

export function orderToCollect(status: string, tickets: StageTicket[]) {
  if (status !== "CONFIRMED" && status !== "COMPLETED") return false;
  const active = tickets.filter((ticket) => ticket.logistics_status !== "CANCELLED_INCIDENT");
  if (!active.length) return false;
  const due = sumCents(active.map(ticket => ticket.agreed_total_cents));
  const paid = sumCents(active.map(ticket => ticket.paid_principal_cents));
  return paid < due;
}

type ClientNames = { first_name: string | null; last_name: string | null; phone: string | null } | null;

export function buildSaleIndexRow(
  sale: { id: string; sale_number: string; sold_at: string; client_id: string | null; status: string; concept: string | null },
  client: ClientNames,
  items: Array<{ product_name_snapshot: string | null; variant_name_snapshot: string | null; sku_snapshot: string | null }>,
): SalesFeedIndexRow {
  const names = items.length
    ? items.map((item) => concatWs([item.product_name_snapshot, item.variant_name_snapshot, item.sku_snapshot])).join(" ")
    : null;
  return {
    kind: "SALE",
    id: sale.id,
    reference: sale.sale_number,
    occurred_at: sale.sold_at,
    client_id: sale.client_id,
    stage: saleStage(sale.status),
    to_collect: false,
    search_text: foldSearchText(
      concatWs([sale.sale_number, sale.concept, client?.first_name, client?.last_name, client?.phone, names]),
    ),
  };
}

export type IndexOrderLine = {
  product_name: string | null;
  variant_name: string | null;
  ticket: (StageTicket & { ticket_number: string; product_name_snapshot: string; variant_name_snapshot: string | null }) | null;
};

export function buildOrderIndexRow(
  order: { id: string; status: string; created_at: string; client_id: string | null },
  client: ClientNames,
  lines: IndexOrderLine[],
): SalesFeedIndexRow {
  const tickets = lines.flatMap((line) => (line.ticket ? [line.ticket] : []));
  const reference = orderReference(order.id);
  const names = lines.length
    ? lines
        .map((line) =>
          concatWs([
            line.ticket?.ticket_number,
            line.ticket?.product_name_snapshot,
            line.ticket?.variant_name_snapshot,
            line.product_name,
            line.variant_name,
          ]),
        )
        .join(" ")
    : null;
  return {
    kind: "ORDER",
    id: order.id,
    reference,
    occurred_at: order.created_at,
    client_id: order.client_id,
    stage: orderStage(order.status, tickets),
    to_collect: orderToCollect(order.status, tickets),
    search_text: foldSearchText(concatWs([reference, client?.first_name, client?.last_name, client?.phone, names])),
  };
}

export function matchesFilter(row: SalesFeedIndexRow, key: string) {
  const filter = resolveSalesFilter(key);
  if (filter.toCollect) return row.to_collect && row.stage !== "CANCELLED";
  if (filter.stage) return row.stage === filter.stage;
  return true;
}

export function countIndexRows(rows: SalesFeedIndexRow[]): SalesFeedCounts {
  const counts: SalesFeedCounts = {
    total: 0,
    open: 0,
    to_collect: 0,
    to_confirm: 0,
    to_order: 0,
    in_transit: 0,
    ready: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    counts.total += 1;
    if (row.stage !== "DELIVERED" && row.stage !== "CANCELLED") counts.open += 1;
    if (row.to_collect && row.stage !== "CANCELLED") counts.to_collect += 1;
    if (row.stage === "TO_CONFIRM") counts.to_confirm += 1;
    if (row.stage === "TO_ORDER") counts.to_order += 1;
    if (row.stage === "IN_TRANSIT") counts.in_transit += 1;
    if (row.stage === "READY") counts.ready += 1;
    if (row.stage === "DELIVERED") counts.delivered += 1;
    if (row.stage === "CANCELLED") counts.cancelled += 1;
  }
  return counts;
}

/** Newest first by default; ties broken by id so pages never overlap. */
export function compareIndexRows(a: SalesFeedIndexRow, b: SalesFeedIndexRow, ascending: boolean) {
  const left = new Date(a.occurred_at).getTime();
  const right = new Date(b.occurred_at).getTime();
  if (left !== right) return ascending ? left - right : right - left;
  if (a.id === b.id) return a.kind.localeCompare(b.kind);
  return ascending ? (a.id < b.id ? -1 : 1) : a.id < b.id ? 1 : -1;
}

/** In-memory twin of the view query: filter, search, sort and slice one page. */
export function pageIndexRows(
  rows: SalesFeedIndexRow[],
  query: { search?: string; filter?: string; ascending?: boolean; page: number; pageSize: number },
) {
  const term = foldSearchText(query.search?.trim() ?? "");
  const matching = rows
    .filter((row) => matchesFilter(row, query.filter ?? "todas"))
    .filter((row) => !term || row.search_text.includes(term))
    .sort((a, b) => compareIndexRows(a, b, Boolean(query.ascending)));
  const from = (query.page - 1) * query.pageSize;
  return { total: matching.length, rows: matching.slice(from, from + query.pageSize) };
}

// ---------------------------------------------------------------------------
// Payment column
// ---------------------------------------------------------------------------

export type PaymentBadgeIcon = "check" | "clock" | "ban" | "refund" | "eye" | "split" | "alert";

export type PaymentBadge = { label: string; tone: BadgeTone; icon: PaymentBadgeIcon };

export const PAYMENT_METHOD_TEXT: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  PAYMENT_LINK: "Link de pago",
};

export function salePayment(sale: { status: string; payment_method: string; sale_type: string }) {
  const method = PAYMENT_METHOD_TEXT[sale.payment_method] ?? sale.payment_method;
  // A counter sale is paid on the spot. Cancelling it (cancelSaleAction) only
  // releases stock: whether the money went back is not recorded anywhere, so
  // the list says "Cancelada" and nothing about a refund.
  const badges: PaymentBadge[] =
    sale.status === "CANCELLED"
      ? [{ label: "Cancelada", tone: "neutral", icon: "ban" }]
      : [{ label: "Recibido", tone: "success", icon: "check" }];
  return { badges, methodText: `${sale.sale_type === "FREE" ? "Venta libre" : "Mostrador"} - ${method}` };
}

export type OrderPaymentInput = {
  orderStatus: string;
  stage: SalesStage;
  tickets: Array<StageTicket & { financial_status: string }>;
  refundedCents: number;
  pendingProofs: number;
  methods: string[];
  planWeeks: number | null;
  requestedWeeks: number | null;
};

export function orderPayment(input: OrderPaymentInput) {
  const active = input.tickets.filter((ticket) => ticket.logistics_status !== "CANCELLED_INCIDENT");
  const due = sumCents(active.map(ticket => ticket.agreed_total_cents));
  const paidActive = sumCents(active.map(ticket => ticket.paid_principal_cents));
  const paidAll = sumCents(input.tickets.map(ticket => ticket.paid_principal_cents));
  const badges: PaymentBadge[] = [];

  if (input.stage === "CANCELLED") {
    badges.push({ label: "Cancelada", tone: "neutral", icon: "ban" });
    if (input.refundedCents > 0) {
      badges.push({ label: cents(input.refundedCents) >= paidAll ? "Reembolsado" : "Reembolso parcial", tone: "neutral", icon: "refund" });
    } else if (paidAll > 0) {
      badges.push({ label: "Pago sin reembolsar", tone: "warning", icon: "alert" });
    }
  } else if (input.orderStatus === "DRAFT") {
    badges.push({ label: "Sin confirmar", tone: "neutral", icon: "clock" });
  } else {
    if (due > 0 && paidActive >= due) badges.push({ label: "Recibido", tone: "success", icon: "check" });
    else if (paidActive > 0) badges.push({ label: "Pago parcial", tone: "warning", icon: "split" });
    else badges.push({ label: "Por cobrar", tone: "warning", icon: "clock" });
    if (input.refundedCents > 0) badges.push({ label: "Reembolso", tone: "neutral", icon: "refund" });
    if (active.some((ticket) => ticket.financial_status === "OVERDUE" || ticket.financial_status === "DEFAULTED")) {
      badges.push({ label: "Atrasado", tone: "danger", icon: "alert" });
    }
  }
  if (input.pendingProofs > 0 && input.stage !== "CANCELLED") {
    badges.push({ label: "Comprobante por revisar", tone: "warning", icon: "eye" });
  }

  const methodLabels = [...new Set(input.methods)].map((method) => PAYMENT_METHOD_TEXT[method] ?? method);
  const weeks = input.planWeeks ?? input.requestedWeeks;
  const plan = weeks ? `Plan semanal ${weeks} sem.` : "Pago completo";
  const methodText = methodLabels.length ? `${plan} - ${methodLabels.join(" + ")}` : `${plan} - Sin pagos registrados`;
  return { badges, methodText, dueCents: safeCents(due), paidCents: safeCents(paidActive) };
}

/** Quoted CSV cells also neutralize spreadsheet formulas in user-entered names. */
export function salesCsvCell(value: string) {
  const safe = /^(\s*[=+@-]|[\t\r\n])/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
