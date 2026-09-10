// Read side of the synchronisation: everything the admin screen shows.
//
// All of it is defensive about the tables not existing yet. This repository has
// no migration runner - database/migrations/*.sql are applied by hand in the
// Supabase SQL editor - so the panel has to be able to say "apply migration 003"
// instead of throwing a 500 at whoever opens it first.

import { adminDb, DEFAULT_BUSINESS_ID } from "../supabase/business";
import { SOURCE_LABELS, SYNC_SOURCES, type SyncSource } from "./types";

export type SyncRunRow = {
  id: string;
  source: SyncSource;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  products_scanned: number;
  products_created: number;
  products_matched: number;
  products_updated: number;
  prices_increased: number;
  products_unchanged: number;
  reviews_created: number;
  error_count: number;
  errors: Array<{ stage?: string; message?: string; at?: string }>;
};

export type SourceCard = {
  source: SyncSource;
  label: string;
  productsFound: number;
  variantsLinked: number;
  productsLinked: number;
  lastRun: SyncRunRow | null;
  lastSeenAt: string | null;
  nextRunAt: string | null;
};

export type PriceComparisonRow = {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string;
  appliedCents: number | null;
  mawmawCents: number | null;
  oskinCents: number | null;
  mawmawUrl: string | null;
  oskinUrl: string | null;
};

export type ReviewRow = {
  id: string;
  source: SyncSource;
  external_name: string;
  external_brand: string | null;
  external_url: string | null;
  external_price_cents: number | null;
  candidate_product_id: string | null;
  candidate_name: string | null;
  similarity: number | null;
  reason: string | null;
  created_at: string;
};

export type PriceChangeRow = {
  id: string;
  product_id: string;
  variant_id: string | null;
  old_price_cents: number;
  new_price_cents: number;
  source_that_caused_change: string;
  detected_at: string;
  productName: string;
  variantName: string;
};

export type SyncDashboard = {
  ready: boolean;
  missingMigration: string | null;
  cards: SourceCard[];
  lastRuns: SyncRunRow[];
  comparisons: PriceComparisonRow[];
  comparisonTotal: number;
  reviews: ReviewRow[];
  priceChanges: PriceChangeRow[];
  intervalMinutes: number;
};

/** Interval the cron is configured at; kept in app_settings so it is one truth. */
async function readIntervalMinutes(): Promise<number> {
  const { data } = await adminDb().from("app_settings").select("value").eq("key", "sync_interval_minutes").maybeSingle();
  const value = Number(data?.value);
  return Number.isFinite(value) && value > 0 ? value : 15;
}

function missingTable(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? "";
  return /schema cache|does not exist/i.test(message);
}

export async function loadSyncDashboard(): Promise<SyncDashboard> {
  const db = adminDb();
  const intervalMinutes = await readIntervalMinutes();

  const probe = await db.from("product_sources").select("id").limit(1);
  if (probe.error && missingTable(probe.error)) {
    return {
      ready: false,
      missingMigration: "003_product_sources_sync.sql",
      cards: SYNC_SOURCES.map((source) => ({
        source,
        label: SOURCE_LABELS[source],
        productsFound: 0,
        variantsLinked: 0,
        productsLinked: 0,
        lastRun: null,
        lastSeenAt: null,
        nextRunAt: null,
      })),
      lastRuns: [],
      comparisons: [],
      comparisonTotal: 0,
      reviews: [],
      priceChanges: [],
      intervalMinutes,
    };
  }
  if (probe.error) throw new Error(probe.error.message);

  const [links, runs, reviews, changes] = await Promise.all([
    selectAllSources(),
    db
      .from("sync_runs")
      .select(
        "id, source, sync_type, status, started_at, finished_at, products_scanned, products_created, products_matched, products_updated, prices_increased, products_unchanged, reviews_created, error_count, errors",
      )
      .order("started_at", { ascending: false })
      .limit(20),
    db
      .from("product_match_reviews")
      .select(
        "id, source, external_name, external_brand, external_url, external_price_cents, candidate_product_id, candidate_name, similarity, reason, created_at",
      )
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("price_change_log")
      .select("id, product_id, variant_id, old_price_cents, new_price_cents, source_that_caused_change, detected_at")
      .order("detected_at", { ascending: false })
      .limit(25),
  ]);

  const runRows = (runs.data ?? []) as SyncRunRow[];
  const cards: SourceCard[] = SYNC_SOURCES.map((source) => {
    const own = links.filter((link) => link.source === source);
    const lastRun = runRows.find((run) => run.source === source) ?? null;
    const lastSeenAt = own.reduce<string | null>(
      (latest, link) => (!latest || (link.last_seen_at && link.last_seen_at > latest) ? link.last_seen_at : latest),
      null,
    );
    return {
      source,
      label: SOURCE_LABELS[source],
      productsFound: new Set(own.map((link) => link.external_product_id)).size,
      variantsLinked: own.filter((link) => link.variant_id).length,
      productsLinked: new Set(own.map((link) => link.product_id)).size,
      lastRun,
      lastSeenAt,
      nextRunAt: lastRun?.finished_at
        ? new Date(new Date(lastRun.finished_at).getTime() + intervalMinutes * 60_000).toISOString()
        : null,
    };
  });

  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const link of links) {
    productIds.add(link.product_id);
    if (link.variant_id) variantIds.add(link.variant_id);
  }
  for (const change of changes.data ?? []) {
    productIds.add(String(change.product_id));
    if (change.variant_id) variantIds.add(String(change.variant_id));
  }

  const [productNames, variantRows] = await Promise.all([
    fetchNames("products", [...productIds]),
    fetchVariants([...variantIds]),
  ]);

  // One row per variant that at least one store quotes a price for, so the
  // comparator can put our applied price next to each store's own price.
  const byVariant = new Map<string, PriceComparisonRow>();
  for (const link of links) {
    if (!link.variant_id) continue;
    const variant = variantRows.get(link.variant_id);
    const key = link.variant_id;
    const row =
      byVariant.get(key) ??
      ({
        productId: link.product_id,
        productName: productNames.get(link.product_id) ?? "—",
        variantId: link.variant_id,
        variantName: variant?.name ?? "—",
        appliedCents: variant?.price_cents ?? null,
        mawmawCents: null,
        oskinCents: null,
        mawmawUrl: null,
        oskinUrl: null,
      } satisfies PriceComparisonRow);
    if (link.source === "mawmaw") {
      row.mawmawCents = link.source_price_cents;
      row.mawmawUrl = link.external_url;
    } else {
      row.oskinCents = link.source_price_cents;
      row.oskinUrl = link.external_url;
    }
    byVariant.set(key, row);
  }

  const comparisons = [...byVariant.values()];
  // Rows quoted by both stores first: those are the ones where the MAX() rule
  // actually had a decision to make.
  comparisons.sort((a, b) => {
    const bothA = a.mawmawCents !== null && a.oskinCents !== null ? 0 : 1;
    const bothB = b.mawmawCents !== null && b.oskinCents !== null ? 0 : 1;
    if (bothA !== bothB) return bothA - bothB;
    return a.productName.localeCompare(b.productName);
  });

  return {
    ready: true,
    missingMigration: null,
    cards,
    lastRuns: runRows,
    comparisons: comparisons.slice(0, 60),
    comparisonTotal: comparisons.length,
    reviews: (reviews.data ?? []) as ReviewRow[],
    priceChanges: (changes.data ?? []).map((change) => ({
      ...(change as Omit<PriceChangeRow, "productName" | "variantName">),
      productName: productNames.get(String(change.product_id)) ?? "—",
      variantName: change.variant_id ? (variantRows.get(String(change.variant_id))?.name ?? "—") : "—",
    })),
    intervalMinutes,
  };
}

type LinkRow = {
  product_id: string;
  variant_id: string | null;
  source: SyncSource;
  external_product_id: string;
  external_url: string | null;
  source_price_cents: number | null;
  last_seen_at: string | null;
};

async function selectAllSources(): Promise<LinkRow[]> {
  const db = adminDb();
  const rows: LinkRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("product_sources")
      .select("product_id, variant_id, source, external_product_id, external_url, source_price_cents, last_seen_at")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as LinkRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function fetchNames(table: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    if (!chunk.length) break;
    const { data } = await adminDb().from(table).select("id, name").in("id", chunk);
    for (const row of data ?? []) names.set(String(row.id), String(row.name));
  }
  return names;
}

async function fetchVariants(ids: string[]): Promise<Map<string, { name: string; price_cents: number }>> {
  const map = new Map<string, { name: string; price_cents: number }>();
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    if (!chunk.length) break;
    const { data } = await adminDb().from("product_variants").select("id, name, price_cents").in("id", chunk);
    for (const row of data ?? []) {
      map.set(String(row.id), { name: String(row.name), price_cents: Number(row.price_cents) });
    }
  }
  return map;
}

export { DEFAULT_BUSINESS_ID };
