/**
 * `products.in_transit` only exists once
 * database/migrations/008_products_in_transit.sql has been applied (by hand,
 * in the Supabase SQL editor — the app only holds a PostgREST key and cannot
 * run DDL). Until then every read that filters on it must keep working exactly
 * as before the column was introduced: the public catalogue and the POS simply
 * skip the filter (no product can be "in transit" before the column exists),
 * and the admin "en camino" list says which file to run instead of failing.
 *
 * Kept free of any Supabase import so both lib/ and app/ code can share it.
 */

export const IN_TRANSIT_MIGRATION_FILE = "database/migrations/008_products_in_transit.sql";

export const IN_TRANSIT_UNAVAILABLE_MESSAGE = `Falta aplicar ${IN_TRANSIT_MIGRATION_FILE} en el editor SQL de Supabase.`;

/**
 * PostgREST reports the missing column in two shapes depending on where it
 * appears: 42703 "column products.in_transit does not exist" for a select or
 * filter, PGRST204 "Could not find the 'in_transit' column of 'products' in the
 * schema cache" for an insert/update payload. Both name the column, which keeps
 * this from swallowing any other schema error.
 */
export function isMissingInTransitColumn(message: string | null | undefined) {
  if (!message || !message.includes("in_transit")) return false;
  return message.includes("does not exist") || message.includes("schema cache") || message.includes("Could not find the");
}

type QueryResult = { error: { message: string } | null };

/**
 * Runs `run(true)` (query including the in_transit filter) and, if the column
 * does not exist yet, re-runs `run(false)` (the same query without it).
 * `inTransitApplied` tells the caller which of the two answered.
 */
export async function withInTransitFallback<R extends QueryResult>(
  run: (filterInTransit: boolean) => PromiseLike<R>,
): Promise<R & { inTransitApplied: boolean }> {
  // No memo of "column missing" on purpose: every call re-checks, so the filter
  // switches on the moment the migration runs and lists are never stale.
  const filtered = await run(true);
  if (!filtered.error || !isMissingInTransitColumn(filtered.error.message)) {
    return Object.assign(filtered, { inTransitApplied: true });
  }
  const unfiltered = await run(false);
  return Object.assign(unfiltered, { inTransitApplied: false });
}
