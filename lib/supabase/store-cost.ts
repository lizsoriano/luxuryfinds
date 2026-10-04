/**
 * "Costo tienda": the owner buys in US stores, in dollars, and wants the cost
 * in pesos worked out for her. Everything here is pure (no Supabase import) so
 * server code, client components and throwaway test scripts can share it; the
 * calculation itself only ever runs on the server (updateVariantQuick).
 *
 * `product_variants.store_cost_usd_cents` / `commission_percent` only exist once
 * database/migrations/009_variant_store_cost.sql has been applied by hand in the
 * Supabase SQL editor. Until then every read that asks for them retries without
 * them (same approach as in_transit / migration 008) and the USD inputs show
 * disabled with a notice naming the file.
 */

export const STORE_COST_MIGRATION_FILE = "database/migrations/009_variant_store_cost.sql";

export const STORE_COST_UNAVAILABLE_MESSAGE = `Falta aplicar ${STORE_COST_MIGRATION_FILE} en el editor SQL de Supabase.`;

export const MISSING_RATE_MESSAGE = "Define el tipo de cambio para calcular el costo.";

/** app_settings keys. The exchange rate has NO default: the owner captures it. */
export const USD_MXN_RATE_KEY = "usd_mxn_rate";
export const US_TAX_FACTOR_KEY = "us_tax_factor";
export const DEFAULT_US_TAX_FACTOR = 1.083;

export type CostSettingKey = typeof USD_MXN_RATE_KEY | typeof US_TAX_FACTOR_KEY;

/** Commission she is charged on the total already including tax: none, 10% or 15%. */
export const COMMISSION_OPTIONS = [0, 10, 15] as const;

export function isCommissionOption(value: number) {
  return (COMMISSION_OPTIONS as readonly number[]).includes(value);
}

/** Settings are stored with at most 4 decimals (18.2345, 1.0825). */
const SETTING_DECIMALS = 4;
const SETTING_SCALE = 10 ** SETTING_DECIMALS;

const SETTING_RULES: Record<CostSettingKey, { min: number; minInclusive: boolean; max: number; message: string }> = {
  usd_mxn_rate: {
    min: 0,
    minInclusive: false,
    max: 100,
    message: "El tipo de cambio debe ser mayor a 0 (por ejemplo 18.25).",
  },
  us_tax_factor: {
    min: 1,
    minInclusive: true,
    max: 1.5,
    message: "El tax debe ser un factor entre 1 y 1.5 (por ejemplo 1.083).",
  },
};

/**
 * Validates a typed setting ("18.25", "1.083"). Returns the number, or an error
 * in Spanish. Up to 4 decimals so the calculation below stays exact.
 */
export function parseCostSetting(key: CostSettingKey, raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const rule = SETTING_RULES[key];
  if (!rule) return { ok: false, error: "Ajuste no válido." };
  const text = typeof raw === "number" ? String(raw) : String(raw ?? "").replace(/[\s$,]/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(text)) {
    return { ok: false, error: text ? rule.message : key === USD_MXN_RATE_KEY ? "Escribe el tipo de cambio." : "Escribe el factor de tax." };
  }
  const value = Number(text);
  const aboveMin = rule.minInclusive ? value >= rule.min : value > rule.min;
  if (!Number.isFinite(value) || !aboveMin || value > rule.max) return { ok: false, error: rule.message };
  return { ok: true, value };
}

/** A stored jsonb value read back; anything unusable reads as "not set". */
export function readStoredSetting(key: CostSettingKey, stored: unknown): number | null {
  if (stored === null || stored === undefined) return null;
  const parsed = parseCostSetting(key, typeof stored === "number" ? Number(stored.toFixed(SETTING_DECIMALS)) : stored);
  return parsed.ok ? parsed.value : null;
}

/**
 * Cost in pesos of a US purchase, in MXN centavos:
 *
 *   store_cost_usd_cents × tax_factor × (1 + commission% / 100) × usd_mxn_rate
 *
 * (USD cents × MXN per USD = MXN cents.) The commission is charged on the total
 * already including tax, so it multiplies after the tax factor. Every factor is
 * scaled to an integer and multiplied with BigInt, so no intermediate step is
 * rounded; the exact result is rounded ONCE, half up, to whole centavos.
 * e.g. US$10.00, tax 1.083, 10%, rate 18 -> 214.434 MXN -> 21443 centavos.
 */
export function computeStoreCostMxnCents(input: {
  storeCostUsdCents: number;
  taxFactor: number;
  commissionPercent: number;
  usdMxnRate: number;
}): number {
  const { storeCostUsdCents, taxFactor, commissionPercent, usdMxnRate } = input;
  if (!Number.isInteger(storeCostUsdCents) || storeCostUsdCents < 0) throw new Error("Costo en USD no válido.");
  if (!(taxFactor > 0) || !(usdMxnRate > 0) || !(commissionPercent >= 0)) throw new Error("Ajustes de costo no válidos.");

  const tax = BigInt(Math.round(taxFactor * SETTING_SCALE)); // ×10^4
  const rate = BigInt(Math.round(usdMxnRate * SETTING_SCALE)); // ×10^4
  const commission = BigInt(Math.round((100 + commissionPercent) * 100)); // (1 + c/100) ×10^4
  const numerator = BigInt(storeCostUsdCents) * tax * commission * rate;
  const denominator = BigInt(SETTING_SCALE) * BigInt(SETTING_SCALE) * BigInt(SETTING_SCALE);
  // Round half up (everything is non-negative).
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
}

/**
 * PostgREST reports the missing columns as 42703 "column product_variants.store_cost_usd_cents
 * does not exist" (select/filter, also "product_variants_1." when embedded) or
 * PGRST204 "Could not find the 'store_cost_usd_cents' column ... in the schema
 * cache" (insert/update). Both name the column.
 */
export function isMissingStoreCostColumn(message: string | null | undefined) {
  if (!message || !(message.includes("store_cost_usd_cents") || message.includes("commission_percent"))) return false;
  return message.includes("does not exist") || message.includes("schema cache") || message.includes("Could not find the");
}

type QueryResult = { error: { message: string } | null };

/**
 * Runs `run(true)` (query asking for the store-cost columns) and, if they do not
 * exist yet, re-runs `run(false)`. No memo on purpose: the moment the migration
 * runs, the next request picks the columns up without a redeploy.
 */
export async function withStoreCostFallback<R extends QueryResult>(
  run: (includeStoreCost: boolean) => PromiseLike<R>,
): Promise<R & { storeCostApplied: boolean }> {
  const withColumns = await run(true);
  if (!withColumns.error || !isMissingStoreCostColumn(withColumns.error.message)) {
    return Object.assign(withColumns, { storeCostApplied: true });
  }
  const without = await run(false);
  return Object.assign(without, { storeCostApplied: false });
}

/** Select fragment for the variant columns, depending on whether 009 is applied. */
export function storeCostColumns(include: boolean) {
  return include ? ", store_cost_usd_cents, commission_percent" : "";
}

/**
 * What the inline "Costo tienda" save returns to the row: the ActionState plus
 * the three columns as the server left them, so the cell shows the peso cost
 * the server calculated (never one worked out in the browser).
 */
export type StoreCostActionState = {
  error: string | null;
  success: string | null;
  variant?: { storeCostUsdCents: number | null; commissionPercent: number; costCents: number };
};

/** "24.5" | "24.50" | "US$ 1,024.50" -> 2450 / 102450 US cents; "" -> null (clear); invalid -> NaN. */
export function parseUsdToCents(raw: unknown): number | null {
  const text = String(raw ?? "")
    .replace(/^\s*US\s*/i, "")
    .replace(/[\s$,]/g, "");
  if (!text) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return Number.NaN;
  return Math.round(Number(text) * 100);
}
