// Where the catalogue crawl got to, remembered BETWEEN invocations.
//
// WHY THIS EXISTS
//
// A run is bounded by the serverless function's time limit (60s on Vercel's
// Hobby plan, of which lib/sync/engine.ts spends ~52s). Maw Maw has ~2,167
// products over ~109 listing pages and Oskin ~3,506 over ~36 Store API pages, so
// one invocation only ever covers a slice of either catalogue. Before this file
// existed both iterators started at page 1 unconditionally, which meant the sync
// re-read the same first ~100 products forever and the rest of the catalogue was
// never reached no matter how many times the cron fired. The run even said so in
// its own error log ("la siguiente corrida continúa desde el inicio del
// catálogo") - honest, but useless.
//
// The checkpoint therefore has to survive the process, which rules out anything
// in memory. It lives in app_settings (key/value jsonb, already the home of
// sync_interval_minutes and friends) under a single key holding both sources:
//
//     sync_cursor -> {"oskin":   {"page": 12, "updatedAt": "...", ...},
//                     "mawmaw":  {"page":  8, "updatedAt": "...", ...}}
//
// One key rather than one per source because the two sources are advanced in the
// same invocation, one after the other, so a read-modify-write of a single row
// is never concurrent with itself.
//
// No migration is needed: app_settings already exists (database/schema.sql) and
// its primary key is the key itself, so a new key is an ordinary upsert.
//
// THE CURSOR RESETS WHEN A PASS FINISHES. A cursor left pointing past the end of
// a finished catalogue would be worse than no cursor at all - the next run would
// find nothing and price changes would stop being noticed. So a run that reached
// the end of the catalogue rewinds to page 1, which is exactly the INITIAL-then-
// INCREMENTAL cycle the engine is meant to have.

import { adminDb } from "../supabase/business";
import { SYNC_SOURCES, type SyncSource } from "./types";

const SETTINGS_KEY = "sync_cursor";

export const FIRST_PAGE = 1;

export type SourceCursor = {
  /** Listing page the NEXT run should start at. FIRST_PAGE means "from the top". */
  page: number;
  updatedAt: string;
  /** Highest page this source has ever reached, so the panel can show progress. */
  highWaterPage?: number;
  /** How the previous run ended, in one word, for the admin panel. */
  lastOutcome?: "truncated" | "completed";
};

export type SyncCursors = Partial<Record<SyncSource, SourceCursor>>;

function isSource(value: string): value is SyncSource {
  return (SYNC_SOURCES as readonly string[]).includes(value);
}

function coerce(value: unknown): SyncCursors {
  if (!value || typeof value !== "object") return {};
  const out: SyncCursors = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isSource(key) || !raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const page = Number(entry.page);
    if (!Number.isFinite(page) || page < FIRST_PAGE) continue;
    out[key] = {
      page: Math.floor(page),
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      highWaterPage: Number.isFinite(Number(entry.highWaterPage)) ? Number(entry.highWaterPage) : undefined,
      lastOutcome: entry.lastOutcome === "truncated" || entry.lastOutcome === "completed" ? entry.lastOutcome : undefined,
    };
  }
  return out;
}

/**
 * Reads every source's checkpoint. Never throws: a sync that cannot read its
 * cursor must still run (from the top) rather than refuse to start.
 */
export async function readSyncCursors(): Promise<SyncCursors> {
  try {
    const { data, error } = await adminDb()
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error) return {};
    return coerce(data?.value);
  } catch {
    return {};
  }
}

/** The page a run of `source` should begin at. */
export async function readStartPage(source: SyncSource): Promise<number> {
  const cursors = await readSyncCursors();
  return cursors[source]?.page ?? FIRST_PAGE;
}

/**
 * Stores one source's checkpoint, leaving the other source's untouched.
 * Returns false when it could not be written, so the caller can say so in the
 * run's error log instead of silently losing the progress.
 */
export async function writeSyncCursor(source: SyncSource, next: SourceCursor): Promise<boolean> {
  try {
    const current = await readSyncCursors();
    const merged: SyncCursors = { ...current, [source]: next };
    const { error } = await adminDb()
      .from("app_settings")
      .upsert(
        {
          key: SETTINGS_KEY,
          value: merged as unknown as Record<string, unknown>,
          description:
            "Página del catálogo donde quedó la última corrida de cada tienda. La siguiente corrida continúa desde ahí; al terminar el catálogo vuelve a 1.",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    return !error;
  } catch {
    return false;
  }
}

/** Forgets one source's progress (or every source) so the next run starts over. */
export async function resetSyncCursor(source?: SyncSource): Promise<boolean> {
  const current = await readSyncCursors();
  const next: SyncCursors = source ? { ...current } : {};
  if (source) delete next[source];
  try {
    const { error } = await adminDb()
      .from("app_settings")
      .upsert(
        {
          key: SETTINGS_KEY,
          value: next as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Rough size of each catalogue, only ever used to render "página 12 de ~36" in
 * the admin panel. Measured against the live stores while writing the adapters:
 * Oskin answers 100 products per Store API page over 36 pages, Maw Maw 20 per
 * listing page over ~109. An estimate that drifts costs nothing - it is a
 * progress hint, never a control-flow decision.
 */
export const ESTIMATED_PAGES: Record<SyncSource, number> = {
  mawmaw: 109,
  oskin: 36,
};
