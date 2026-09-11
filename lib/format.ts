// Pure formatting helpers shared by server and client components.
// Deliberately free of any Supabase import so client bundles stay small.

const MONEY = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONEY_COMPACT = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export function formatMoney(cents: number) {
  return MONEY.format((Number(cents) || 0) / 100);
}

export function formatMoneyCompact(cents: number) {
  return MONEY_COMPACT.format((Number(cents) || 0) / 100);
}

/** "1234.5" | "1,234.50" | "$1,234.50" -> 123450 cents. Returns null when unparseable. */
export function parseMoneyToCents(value: FormDataEntryValue | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/[^\d.-]/g, "").trim();
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

/** Quantities can be fractional for products sold by measure. */
export function parseQuantity(value: FormDataEntryValue | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/[^\d.-]/g, "").trim();
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 1000) / 1000;
}

export function formatQuantity(quantity: number, unitLabel?: string | null) {
  const value = Number(quantity) || 0;
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return unitLabel ? `${text} ${unitLabel}` : text;
}

const DATE = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mazatlan" });
const DATE_TIME = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mazatlan" });
const TIME = new Intl.DateTimeFormat("es-MX", { timeStyle: "short", timeZone: "America/Mazatlan" });

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value.length === 10 ? `${value}T12:00:00` : value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return DATE.format(date);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_TIME.format(date);
}

/** Just the clock time, for day-scoped grids where the date is already on screen. */
export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return TIME.format(date);
}

/** Business-local (America/Mazatlan) calendar day as YYYY-MM-DD. */
export function businessToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "LF";
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  TRANSFER: "Transferencia",
  CASH: "Efectivo",
  PAYMENT_LINK: "Link de pago",
};

export const PAYMENT_METHODS = ["CASH", "TRANSFER", "PAYMENT_LINK"] as const;

/** Mirrors the `financial_status` enum in database/schema.sql. */
export const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  AWAITING_FIRST_PAYMENT: "Sin primer pago",
  PROOF_PENDING: "Comprobante por revisar",
  PARTIALLY_PAID: "Pago parcial",
  CURRENT: "Al corriente",
  OVERDUE: "Atrasado",
  PAID: "Pagado",
  DEFAULTED: "Incumplido",
  CANCELLED_INCIDENT: "Cancelado",
  REFUND_PENDING: "Reembolso en proceso",
  REFUNDED: "Reembolsado",
};

export const LOGISTICS_STATUS_LABELS: Record<string, string> = {
  WAITING_TO_ORDER: "Esperando pedido",
  READY_TO_ORDER: "Listo para ordenar",
  ORDERED: "Ordenado",
  IN_TRANSIT: "En camino",
  RECEIVED_LA_PAZ: "Recibido en La Paz",
  READY_FOR_DELIVERY: "Listo para entrega",
  DELIVERY_SCHEDULED: "Entrega programada",
  DELIVERED: "Entregado",
  CANCELLED_INCIDENT: "Cancelado",
};
