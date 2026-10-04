/**
 * Compras con shopper — the money, as pure functions (no Supabase import), so
 * server code, client components and throwaway test scripts share one
 * implementation. Amounts captured in the store are US cents; what is paid to
 * the shopper and the frozen costs are MXN centavos. Every multiplication by a
 * rate or a percentage is done on scaled integers with BigInt and each
 * magnitude is rounded ONCE, half up, to whole cents:
 *
 *   total_real_usd = Σ tickets' real totals (tax included)          (exact sum)
 *   commission_usd = round(total_real_usd × commission% / 100)      (rounded once)
 *   owed_usd       = total_real_usd + commission_usd                (exact sum)
 *   owed_mxn       = round(owed_usd × exchange_rate)                (rounded once)
 *
 * The commission is its own magnitude — the cents the shopper actually charges —
 * so owed_mxn is the peso value of the dollar amount she bills (e.g. US$44.63 at
 * 18.0000 -> $803.34), not a re-derivation from unrounded parts.
 *
 * Per line (frozen at confirmation, used by later phases and for margins):
 *   line_cost_mxn = owed_mxn split by largest remainder, first across tickets in
 *                   proportion to each ticket's real total, then inside each
 *                   ticket in proportion to each line's subtotal. The lines of a
 *                   ticket add up exactly to the ticket's share, and all lines
 *                   add up exactly to owed_mxn.
 *   unit_cost_mxn = round(line_cost_mxn / quantity). With quantity > 1 the units
 *                   can differ from the line by less than `quantity` centavos;
 *                   line_cost_mxn is the exact figure.
 * Shipping is not included: it is prorated when the shipment exists (phase 3).
 */

import { parseCostSetting, parseUsdToCents } from "./store-cost";

export { parseUsdToCents };

export const PURCHASE_MIGRATION_FILE = "database/migrations/010_shopper_purchases.sql";

/** The only two commissions the owner's shoppers charge. */
export const PURCHASE_COMMISSION_OPTIONS = [10, 15] as const;
export type PurchaseCommission = (typeof PURCHASE_COMMISSION_OPTIONS)[number];

export function isPurchaseCommission(value: unknown): value is PurchaseCommission {
  return (PURCHASE_COMMISSION_OPTIONS as readonly number[]).includes(Number(value)) && String(value).trim() !== "";
}

export const MAX_ITEM_QUANTITY = 9999;
/** US$1,000,000 — anything above is a typo, not a purchase. */
export const MAX_USD_CENTS = 100_000_000;

// BigInt(...) instead of 123n literals: the project's TypeScript target is below ES2020.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const RATE_SCALE = BigInt(10_000); // exchange_rate has 4 decimals

/** Half-up integer division for non-negative operands. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * TWO + denominator) / (denominator * TWO);
}

/** "18.25" | 18.25 -> 182500n (×10^4). Throws on more than 4 decimals or ≤ 0. */
export function rateToScaled(rate: number | string): bigint {
  const text = typeof rate === "number" ? String(rate) : rate.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(text)) throw new Error("Tipo de cambio no válido.");
  const [whole, fraction = ""] = text.split(".");
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(4, "0"));
  if (scaled <= ZERO) throw new Error("Tipo de cambio no válido.");
  return scaled;
}

/** Validates a typed exchange rate: > 0, at most 4 decimals, ≤ 100 (same rule as Productos). */
export function parseExchangeRate(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "Escribe el tipo de cambio de esta compra (por ejemplo 18.25)." };
  return parseCostSetting("usd_mxn_rate", text);
}

export function parseCommission(raw: unknown): { ok: true; value: PurchaseCommission } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!isPurchaseCommission(text)) return { ok: false, error: "Elige la comisión del shopper: 10 % o 15 %." };
  return { ok: true, value: Number(text) as PurchaseCommission };
}

/** US cents × MXN per USD = MXN centavos, rounded once. */
export function usdCentsToMxnCents(usdCents: number, rate: number | string): number {
  if (!Number.isInteger(usdCents) || usdCents < 0) throw new Error("Monto en USD no válido.");
  return Number(divRoundHalfUp(BigInt(usdCents) * rateToScaled(rate), RATE_SCALE));
}

export function computeCommissionUsdCents(totalRealUsdCents: number, commissionPercent: number): number {
  if (!Number.isInteger(totalRealUsdCents) || totalRealUsdCents < 0) throw new Error("Total no válido.");
  if (!isPurchaseCommission(commissionPercent)) throw new Error("Comisión no válida.");
  return Number(divRoundHalfUp(BigInt(totalRealUsdCents) * BigInt(commissionPercent), HUNDRED));
}

/** What she owes the shopper for a given total with tax: total + commission, in USD and MXN. */
export function computeOwed(totalWithTaxUsdCents: number, commissionPercent: number, rate: number | string) {
  const commissionUsdCents = computeCommissionUsdCents(totalWithTaxUsdCents, commissionPercent);
  const owedUsdCents = totalWithTaxUsdCents + commissionUsdCents;
  return { commissionUsdCents, owedUsdCents, owedMxnCents: usdCentsToMxnCents(owedUsdCents, rate) };
}

/**
 * Splits `total` integer cents in proportion to `weights` (non-negative
 * integers) by largest remainder: everyone gets floor(total × w / W), and the
 * cents left over go one by one to the largest fractional parts (ties: first in
 * order). The result always adds up to `total` exactly. All-zero weights split
 * evenly.
 */
export function allocateLargestRemainder(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error("Monto a repartir no válido.");
  if (!weights.length) {
    if (total !== 0) throw new Error("No hay entre quién repartir.");
    return [];
  }
  let w = weights.map((value) => {
    if (!Number.isInteger(value) || value < 0) throw new Error("Peso de reparto no válido.");
    return BigInt(value);
  });
  if (w.every((value) => value === ZERO)) w = w.map(() => ONE);
  const sum = w.reduce((acc, value) => acc + value, ZERO);
  const big = BigInt(total);
  const shares = w.map((value) => (big * value) / sum);
  const remainders = w.map((value, index) => ({ index, rest: (big * value) % sum }));
  let left = big - shares.reduce((acc, value) => acc + value, ZERO);
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (left <= ZERO) break;
    shares[index] += ONE;
    left -= ONE;
  }
  return shares.map((value) => Number(value));
}

// ---------------------------------------------------------------------------
// Live totals (what the capture screen shows while the purchase is OPEN)
// ---------------------------------------------------------------------------

export type ItemAmounts = { quantity: number; unitPriceUsdCents: number };

export function lineSubtotalUsdCents(item: ItemAmounts) {
  return item.quantity * item.unitPriceUsdCents;
}

/**
 * SHORT: the receipt says more than what was captured (falta capturar algo).
 * OVER:  more was captured than the receipt says (sobra algo / precio de más).
 */
export type TicketBalance = "MISSING_TOTAL" | "BALANCED" | "SHORT" | "OVER";

export const TICKET_BALANCE_LABELS: Record<TicketBalance, string> = {
  MISSING_TOTAL: "Falta el total del ticket",
  BALANCED: "Cuadra",
  SHORT: "Falta capturar",
  OVER: "Sobra",
};

export const TICKET_BALANCE_TONES: Record<TicketBalance, "neutral" | "success" | "warning" | "danger"> = {
  MISSING_TOTAL: "neutral",
  BALANCED: "success",
  SHORT: "warning",
  OVER: "danger",
};

export type TicketSummary = {
  pieces: number;
  subtotalUsdCents: number;
  taxUsdCents: number;
  /** Subtotal + the ticket's tax (counted once). */
  capturedWithTaxUsdCents: number;
  realTotalUsdCents: number | null;
  /** real − captured with tax; null until the real total is typed. */
  differenceUsdCents: number | null;
  balance: TicketBalance;
};

export function summarizeTicket(ticket: {
  taxUsdCents: number;
  realTotalUsdCents: number | null;
  items: ItemAmounts[];
}): TicketSummary {
  const subtotal = ticket.items.reduce((sum, item) => sum + lineSubtotalUsdCents(item), 0);
  const pieces = ticket.items.reduce((sum, item) => sum + item.quantity, 0);
  const captured = subtotal + ticket.taxUsdCents;
  const real = ticket.realTotalUsdCents;
  const difference = real === null ? null : real - captured;
  return {
    pieces,
    subtotalUsdCents: subtotal,
    taxUsdCents: ticket.taxUsdCents,
    capturedWithTaxUsdCents: captured,
    realTotalUsdCents: real,
    differenceUsdCents: difference,
    balance: difference === null ? "MISSING_TOTAL" : difference === 0 ? "BALANCED" : difference > 0 ? "SHORT" : "OVER",
  };
}

/** "  Sephora ", "SEPHORA", "Séphora" -> one store for the per-store totals. */
export function storeKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type StoreSummary = {
  key: string;
  storeName: string;
  ticketCount: number;
  pieces: number;
  subtotalUsdCents: number;
  taxUsdCents: number;
  capturedWithTaxUsdCents: number;
};

export function summarizeStores(tickets: Array<{ storeName: string; summary: TicketSummary }>): StoreSummary[] {
  const stores = new Map<string, StoreSummary>();
  for (const { storeName, summary } of tickets) {
    const key = storeKey(storeName);
    const current =
      stores.get(key) ??
      { key, storeName: storeName.trim(), ticketCount: 0, pieces: 0, subtotalUsdCents: 0, taxUsdCents: 0, capturedWithTaxUsdCents: 0 };
    current.ticketCount += 1;
    current.pieces += summary.pieces;
    current.subtotalUsdCents += summary.subtotalUsdCents;
    current.taxUsdCents += summary.taxUsdCents;
    current.capturedWithTaxUsdCents += summary.capturedWithTaxUsdCents;
    stores.set(key, current);
  }
  return [...stores.values()];
}

export type PurchaseSummary = {
  ticketCount: number;
  pieces: number;
  subtotalUsdCents: number;
  taxUsdCents: number;
  capturedWithTaxUsdCents: number;
  /** Every ticket has its real total typed in. */
  allTotalsCaptured: boolean;
  /** Σ real totals where known, captured-with-tax where not: the best current estimate. */
  bestTotalUsdCents: number;
  /** Net difference over the tickets that have a real total. */
  differenceUsdCents: number;
  /** At least one ticket with a real total does not square. */
  anyDifference: boolean;
};

export function summarizePurchase(summaries: TicketSummary[]): PurchaseSummary {
  return {
    ticketCount: summaries.length,
    pieces: summaries.reduce((sum, s) => sum + s.pieces, 0),
    subtotalUsdCents: summaries.reduce((sum, s) => sum + s.subtotalUsdCents, 0),
    taxUsdCents: summaries.reduce((sum, s) => sum + s.taxUsdCents, 0),
    capturedWithTaxUsdCents: summaries.reduce((sum, s) => sum + s.capturedWithTaxUsdCents, 0),
    allTotalsCaptured: summaries.length > 0 && summaries.every((s) => s.realTotalUsdCents !== null),
    bestTotalUsdCents: summaries.reduce((sum, s) => sum + (s.realTotalUsdCents ?? s.capturedWithTaxUsdCents), 0),
    differenceUsdCents: summaries.reduce((sum, s) => sum + (s.differenceUsdCents ?? 0), 0),
    anyDifference: summaries.some((s) => s.differenceUsdCents !== null && s.differenceUsdCents !== 0),
  };
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export type ConfirmationTicketInput = {
  id: string;
  storeName: string;
  taxUsdCents: number;
  realTotalUsdCents: number | null;
  items: Array<ItemAmounts & { id: string }>;
};

export type ConfirmationSnapshot = {
  exchange_rate: number;
  commission_percent: number;
  captured_subtotal_usd_cents: number;
  tax_usd_cents: number;
  total_real_usd_cents: number;
  difference_usd_cents: number;
  difference_acknowledged: boolean;
  commission_usd_cents: number;
  owed_usd_cents: number;
  owed_mxn_cents: number;
  tickets: Array<{ id: string; tax_usd_cents: number; real_total_usd_cents: number; share_mxn_cents: number }>;
  items: Array<{
    id: string;
    ticket_id: string;
    quantity: number;
    unit_price_usd_cents: number;
    line_cost_mxn_cents: number;
    unit_cost_mxn_cents: number;
  }>;
};

/**
 * Everything "Confirmar compra" freezes, or the reason it cannot be confirmed
 * yet. A missing ticket photo is NOT a reason (the panel only warns about it).
 */
export function computePurchaseConfirmation(input: {
  exchangeRate: number;
  commissionPercent: number;
  tickets: ConfirmationTicketInput[];
  acknowledgeDifference: boolean;
}): { ok: true; snapshot: ConfirmationSnapshot } | { ok: false; error: string } {
  const { exchangeRate, commissionPercent, tickets } = input;
  try {
    rateToScaled(exchangeRate);
  } catch {
    return { ok: false, error: "El tipo de cambio de la compra no es válido." };
  }
  if (!isPurchaseCommission(commissionPercent)) return { ok: false, error: "La comisión debe ser 10 % o 15 %." };
  if (!tickets.length) return { ok: false, error: "Agrega al menos un ticket con artículos antes de confirmar." };

  for (const ticket of tickets) {
    if (!ticket.items.length) {
      return { ok: false, error: `El ticket de ${ticket.storeName} no tiene artículos: captúralos o borra el ticket.` };
    }
    if (ticket.realTotalUsdCents === null) {
      return { ok: false, error: `Falta el total con tax del ticket de ${ticket.storeName}.` };
    }
    for (const item of ticket.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isInteger(item.unitPriceUsdCents) || item.unitPriceUsdCents < 0) {
        return { ok: false, error: `Hay un artículo con cantidad o precio no válido en el ticket de ${ticket.storeName}.` };
      }
    }
  }

  const summaries = tickets.map((ticket) => summarizeTicket(ticket));
  const purchase = summarizePurchase(summaries);
  if (purchase.anyDifference && !input.acknowledgeDifference) {
    return {
      ok: false,
      error: "Hay tickets que no cuadran. Revisa la diferencia o marca “Confirmo la diferencia” para continuar.",
    };
  }

  const totalReal = tickets.reduce((sum, ticket) => sum + (ticket.realTotalUsdCents ?? 0), 0);
  const owed = computeOwed(totalReal, commissionPercent, exchangeRate);

  const ticketShares = allocateLargestRemainder(
    owed.owedMxnCents,
    tickets.map((ticket) => ticket.realTotalUsdCents ?? 0),
  );
  const items: ConfirmationSnapshot["items"] = [];
  tickets.forEach((ticket, index) => {
    const lineCosts = allocateLargestRemainder(
      ticketShares[index],
      ticket.items.map((item) => lineSubtotalUsdCents(item)),
    );
    ticket.items.forEach((item, itemIndex) => {
      const line = lineCosts[itemIndex];
      items.push({
        id: item.id,
        ticket_id: ticket.id,
        quantity: item.quantity,
        unit_price_usd_cents: item.unitPriceUsdCents,
        line_cost_mxn_cents: line,
        unit_cost_mxn_cents: Number(divRoundHalfUp(BigInt(line), BigInt(item.quantity))),
      });
    });
  });

  return {
    ok: true,
    snapshot: {
      exchange_rate: exchangeRate,
      commission_percent: commissionPercent,
      captured_subtotal_usd_cents: purchase.subtotalUsdCents,
      tax_usd_cents: purchase.taxUsdCents,
      total_real_usd_cents: totalReal,
      difference_usd_cents: purchase.differenceUsdCents,
      difference_acknowledged: purchase.anyDifference,
      commission_usd_cents: owed.commissionUsdCents,
      owed_usd_cents: owed.owedUsdCents,
      owed_mxn_cents: owed.owedMxnCents,
      tickets: tickets.map((ticket, index) => ({
        id: ticket.id,
        tax_usd_cents: ticket.taxUsdCents,
        real_total_usd_cents: ticket.realTotalUsdCents ?? 0,
        share_mxn_cents: ticketShares[index],
      })),
      items,
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const USD = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 102450 -> "US$1,024.50"; negative -> "-US$3.00". */
export function formatUsd(cents: number) {
  const value = Number(cents) || 0;
  return `${value < 0 ? "-" : ""}US$${USD.format(Math.abs(value) / 100)}`;
}

/** 4057 -> "40.57": the value a dollars <input> shows. */
export function usdCentsToInput(cents: number | null | undefined) {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

/** "18.2500" / 18.25 -> "18.25" for display. */
export function formatRate(rate: number | string) {
  const value = Number(rate);
  return Number.isFinite(value) ? value.toFixed(4).replace(/0{1,2}$/, "") : String(rate);
}
