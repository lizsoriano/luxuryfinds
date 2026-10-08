// Acciones masivas del panel (Inventario y las 3 listas de Productos).
// Pure module: types, limits and the price arithmetic shared by the dialog's
// preview (client) and the server that applies it. No Supabase import.

/**
 * What each selected id is:
 *  - "products": a product id (Productos / Entrega inmediata / En camino).
 *  - "variants": a product_variants id (Inventario, one row per variant).
 */
export type BulkScope = "products" | "variants";

/** The list filters "Seleccionar todos los resultados" resolves on the server. */
export type BulkFilter = {
  search?: string;
  categoryId?: string;
  includeArchived?: boolean;
  /** Productos lists only. */
  segment?: "online" | "inmediata" | "en-camino";
  /** Inventario only. Unlike the page (current page only), applied across every page here. */
  stockFilter?: "all" | "out" | "low";
};

export type BulkActionKind = "price" | "hide" | "show" | "archive" | "restore" | "category" | "brand";

/** Most units one bulk action may touch (a selection by filter beyond this is refused). */
export const BULK_SELECTION_CAP = 5000;

/** Ids sent per server call. Small requests stay far below the 1 MB body limit and the ~60 s function limit. */
export const BULK_CHUNK_SIZE: Record<BulkActionKind, number> = {
  price: 60,
  hide: 200,
  show: 200,
  archive: 250,
  restore: 250,
  category: 250,
  brand: 250,
};

/** Ids per preview / count call. */
export const BULK_INSPECT_CHUNK = 500;

export type BulkItemIssue = { id: string; name: string; reason: string };

export type BulkChunkResult =
  | {
      ok: true;
      /** Units changed: variants for Inventario price edits, products otherwise. */
      updated: number;
      /** Variants whose price changed (price action only). */
      variantsUpdated: number;
      omitted: BulkItemIssue[];
      errors: BulkItemIssue[];
      /** True when this exact batch had already been applied (repeated request): nothing was done twice. */
      replay: boolean;
    }
  | { ok: false; error: string };

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Price arithmetic — integer cents, rounding applied exactly once.
// ---------------------------------------------------------------------------

export type BulkPriceMode = "fixed" | "percent" | "amount";
export type BulkPriceRounding = "none" | "peso" | "five";

export type BulkPriceParams = {
  mode: BulkPriceMode;
  /**
   * fixed:   the new price in cents (> 0).
   * percent: signed basis points (hundredths of a percent): +1050 = +10.5 %.
   * amount:  signed cents to add.
   */
  value: number;
  /** Only used by "percent": round the result to the cent, to whole pesos or to multiples of $5. */
  rounding: BulkPriceRounding;
};

/** $1,000,000: far above any boutique price; stops a stray extra digit block. */
export const BULK_PRICE_MAX_CENTS = 100_000_000;

const ROUNDING_UNIT: Record<BulkPriceRounding, bigint> = { none: BigInt(1), peso: BigInt(100), five: BigInt(500) };
const TEN_THOUSAND = BigInt(10_000);
const TWO = BigInt(2);

export const ROUNDING_LABEL: Record<BulkPriceRounding, string> = {
  none: "sin redondeo (al centavo)",
  peso: "redondeado a peso entero",
  five: "redondeado a múltiplos de $5",
};

/** Exact decimal string -> integer scaled by 10^decimals; null if not a plain non-negative number. */
function parseScaled(raw: string, decimals: number): number | null {
  const text = raw.trim().replace(/,/g, "").replace(/^\$/, "").replace(/%$/, "").trim();
  const match = new RegExp(`^(\\d{1,9})(?:\\.(\\d{1,${decimals}}))?$`).exec(text);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  return Number(match[1]) * 10 ** decimals + Number(fraction || "0");
}

export type BulkPriceInput = {
  mode: string;
  /** What she typed: "199.90", "10", "12.5". Always positive; the direction says up or down. */
  value: string;
  direction: string;
  rounding: string;
};

/** Validates the dialog's fields (on the client for the preview, again on the server before writing). */
export function parseBulkPriceInput(input: BulkPriceInput): { ok: true; params: BulkPriceParams } | { ok: false; error: string } {
  const mode = input.mode as BulkPriceMode;
  if (mode !== "fixed" && mode !== "percent" && mode !== "amount") return { ok: false, error: "Elige cómo cambiar el precio." };
  const rounding = (["none", "peso", "five"] as const).includes(input.rounding as BulkPriceRounding)
    ? (input.rounding as BulkPriceRounding)
    : "none";
  const down = input.direction === "down";
  if (input.direction !== "up" && input.direction !== "down" && mode !== "fixed") {
    return { ok: false, error: "Elige subir o bajar." };
  }

  if (mode === "percent") {
    const basisPoints = parseScaled(input.value, 2);
    if (basisPoints === null || basisPoints <= 0) return { ok: false, error: "Escribe un porcentaje válido (por ejemplo 10 o 12.5)." };
    if (down && basisPoints >= 10_000) return { ok: false, error: "No se puede bajar 100 % o más." };
    if (!down && basisPoints > 100_000) return { ok: false, error: "El aumento máximo es 1000 %." };
    return { ok: true, params: { mode, value: down ? -basisPoints : basisPoints, rounding } };
  }

  const cents = parseScaled(input.value, 2);
  if (cents === null) return { ok: false, error: "Escribe una cantidad en pesos válida (por ejemplo 199.90)." };
  if (mode === "fixed") {
    if (cents < 1) return { ok: false, error: "El precio debe ser de al menos $0.01." };
    if (cents > BULK_PRICE_MAX_CENTS) return { ok: false, error: "Ese precio es demasiado alto. Revísalo." };
    return { ok: true, params: { mode, value: cents, rounding: "none" } };
  }
  if (cents < 1) return { ok: false, error: "Escribe una cantidad mayor a $0." };
  if (cents > BULK_PRICE_MAX_CENTS) return { ok: false, error: "Esa cantidad es demasiado alta. Revísala." };
  return { ok: true, params: { mode, value: down ? -cents : cents, rounding: "none" } };
}

/** Server side: the params arrive as JSON; re-check every field instead of trusting them. */
export function isValidBulkPriceParams(params: unknown): params is BulkPriceParams {
  if (!params || typeof params !== "object") return false;
  const { mode, value, rounding } = params as Record<string, unknown>;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  if (rounding !== "none" && rounding !== "peso" && rounding !== "five") return false;
  if (mode === "fixed") return value >= 1 && value <= BULK_PRICE_MAX_CENTS && rounding === "none";
  if (mode === "percent") return value !== 0 && value > -10_000 && value <= 100_000;
  if (mode === "amount") return value !== 0 && Math.abs(value) <= BULK_PRICE_MAX_CENTS && rounding === "none";
  return false;
}

export type BulkPriceOutcome = { ok: true; next: number } | { ok: false; reason: string };

/**
 * New price for one variant. Percent: previous × (10000 + bp) / 10000 computed
 * in BigInt and rounded half-up ONCE to the chosen unit (1 ¢, $1 or $5).
 * Results below $0.01 or above BULK_PRICE_MAX_CENTS are refused.
 */
export function computeBulkPrice(previousCents: number, params: BulkPriceParams): BulkPriceOutcome {
  const previous = Number(previousCents);
  if (!Number.isSafeInteger(previous) || previous < 0) return { ok: false, reason: "El precio actual no es válido." };

  let next: number;
  if (params.mode === "fixed") {
    next = params.value;
  } else if (params.mode === "amount") {
    next = previous + params.value;
  } else {
    const numerator = BigInt(previous) * BigInt(10_000 + params.value);
    const denominator = TEN_THOUSAND * ROUNDING_UNIT[params.rounding];
    // numerator >= 0 (bp > -10000), so floor((2·num + den) / (2·den)) is round-half-up.
    const units = (numerator * TWO + denominator) / (denominator * TWO);
    next = Number(units * ROUNDING_UNIT[params.rounding]);
  }

  if (!Number.isSafeInteger(next) || next < 1) return { ok: false, reason: "El precio quedaría en menos de $0.01." };
  if (next > BULK_PRICE_MAX_CENTS) return { ok: false, reason: "El precio quedaría demasiado alto." };
  return { ok: true, next };
}

/** "Subir 10 % (redondeado a peso entero)" — the summary line of the confirmation. */
export function describeBulkPrice(params: BulkPriceParams, money: (cents: number) => string): string {
  if (params.mode === "fixed") return `Poner el precio en ${money(params.value)}`;
  if (params.mode === "amount") {
    return `${params.value > 0 ? "Sumar" : "Restar"} ${money(Math.abs(params.value))} al precio actual`;
  }
  const percent = Math.abs(params.value) / 100;
  return `${params.value > 0 ? "Subir" : "Bajar"} ${percent.toLocaleString("es-MX", { maximumFractionDigits: 2 })} % (${ROUNDING_LABEL[params.rounding]})`;
}

/** Splits a list into consecutive pieces of at most `size`. */
export function chunkList<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
