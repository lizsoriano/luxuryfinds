// The synchronisation engine: read a storefront, decide what each row means for
// our catalogue, write the minimum needed, and account for all of it.
//
// THE PRICE RULE (the important one)
//
//   final Luxury Finds price = MAX(current Luxury Finds price,
//                                  current Maw Maw price,
//                                  current Oskin price)   -- per VARIANT
//
// applied per variant, never per product. Our own current price is one of the
// operands, so the price can only ever rise: when a store drops its price the
// MAX is unchanged and no UPDATE is issued at all. That also means the two
// sources do not need to be read in the same run - whatever the other store
// pushed the price up to last time is already part of `current Luxury Finds
// price` today, so syncing them one at a time still computes the true maximum.
//
// Each store's own price is stored separately on its product_sources row and is
// never overwritten by the other store's or by ours. The price actually applied
// is only ever written to product_variants.price_cents, and only when it really
// changes - every such change is appended to price_change_log with the source
// that caused it.
//
// A variant whose store price could not be read (missing, zero, "price on
// request") is marked needs_price_review and takes no part in the MAX, so a
// scraping gap can never publish something at $0.
//
// FAILURE POLICY: one bad product, page or variation is recorded in the run's
// error list and the run continues. Only an error that makes the whole run
// meaningless (catalogue unreadable, sync_runs unwritable) aborts it.

import { adminDb, DEFAULT_BUSINESS_ID, MAX_PRODUCT_IMAGES } from "../supabase/business";
import { CatalogIndex, type MatchMethod } from "./catalog-index";
import { FIRST_PAGE, readStartPage, resetSyncCursor, writeSyncCursor } from "./cursor";
import { copyProductImages } from "./images";
import { slugify } from "./normalize";
import { iterateMawMawProducts } from "./sources/mawmaw";
import { iterateOskinProducts } from "./sources/oskin";
import {
  emptyCounters,
  SOURCE_LABELS,
  type PriceMove,
  type SourcePage,
  type SourceProduct,
  type SourceVariant,
  type SyncCounters,
  type SyncError,
  type SyncSource,
  type SyncStatus,
  type SyncType,
} from "./types";

const BATCH_SIZE = 50;
/** Guard rail so a single invocation cannot run past a serverless time limit. */
const DEFAULT_BUDGET_MS = 240_000;

/**
 * Image work stops this long before the deadline. Copying photos is the slowest
 * thing the engine does (~130ms each at IMAGE_CONCURRENCY, against ~10ms for a
 * row write), and it must never be the reason the function is killed before it
 * can save its checkpoint - a lost cursor costs the whole next invocation,
 * whereas a skipped photo is picked up on the next pass over that page.
 */
const IMAGE_TAIL_MS = 8_000;

export type RunOptions = {
  source: SyncSource;
  syncType: SyncType;
  /** Recompute everything without touching the database. Used for verification. */
  dryRun?: boolean;
  /** Maximum listing pages to walk. Omit for the whole catalogue. */
  maxPages?: number;
  budgetMs?: number;
  /** Maw Maw only: also run the /marcas/ pass that recovers brands. */
  withBrands?: boolean;
  /** Start from page 1 and forget the stored checkpoint. */
  resetCursor?: boolean;
  onProgress?: (counters: SyncCounters) => void;
};

/** Where the crawl started and where it left off, for the caller to report. */
export type CursorReport = {
  startedAtPage: number;
  nextPage: number;
  /** True when the run reached the end of the catalogue and rewound to page 1. */
  wrapped: boolean;
  saved: boolean;
};

export type RunResult = {
  runId: string | null;
  source: SyncSource;
  syncType: SyncType;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string;
  counters: SyncCounters;
  errors: SyncError[];
  priceMoves: PriceMove[];
  createdSamples: Array<{ name: string; url: string; priceCents: number | null }>;
  matchedByMethod: Record<string, number>;
  dryRun: boolean;
  cursor: CursorReport;
  /** Photos copied from the storefront into our own bucket during this run. */
  imagesStored: number;
};

function nowIso() {
  return new Date().toISOString();
}

class ErrorLog {
  readonly items: SyncError[] = [];
  private overflow = 0;

  add(stage: string, message: string, externalId?: string) {
    // 200 is plenty to diagnose a run; past that we only keep the count so a
    // pathological run cannot blow up the jsonb column or the response.
    if (this.items.length >= 200) {
      this.overflow += 1;
      return;
    }
    this.items.push({ stage, message: message.slice(0, 500), externalId, at: nowIso() });
  }

  get total() {
    return this.items.length + this.overflow;
  }
}

// ---------------------------------------------------------------------------
// Price rule
// ---------------------------------------------------------------------------

/**
 * Returns the price that should be applied to a variant, or null when nothing
 * should change. Exported because it is the single most important rule in this
 * system and deserves to be testable on its own.
 */
export function resolvePrice(currentCents: number, sourceVariant: SourceVariant): number | null {
  if (sourceVariant.needsPriceReview) return null;
  const candidate = sourceVariant.priceCents;
  if (candidate === null || candidate <= 0) return null;
  return candidate > currentCents ? candidate : null;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

type BrandResolver = (name: string | null) => Promise<string | null>;

function makeBrandResolver(dryRun: boolean): BrandResolver {
  const cache = new Map<string, string | null>();
  let loaded: Map<string, string> | null = null;

  return async (name) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    if (cache.has(key)) return cache.get(key) ?? null;

    if (!loaded) {
      const { data, error } = await adminDb().from("brands").select("id, name").range(0, 4999);
      if (error) throw new Error(`brands: ${error.message}`);
      loaded = new Map((data ?? []).map((row) => [String(row.name).toLowerCase(), String(row.id)]));
    }

    // The catalogue stores several brands with the storefront's "Más de X" link
    // text; both spellings must resolve to the same brand row.
    const existing = loaded.get(key) ?? loaded.get(`más de ${key}`) ?? loaded.get(`mas de ${key}`) ?? null;
    if (existing) {
      cache.set(key, existing);
      return existing;
    }
    if (dryRun) {
      cache.set(key, null);
      return null;
    }
    const { data, error } = await adminDb().from("brands").insert({ name: trimmed }).select("id").single();
    if (error) {
      // A concurrent insert of the same brand is not an error worth failing on.
      cache.set(key, null);
      return null;
    }
    loaded.set(key, String(data.id));
    cache.set(key, String(data.id));
    return String(data.id);
  };
}

async function loadCategoryIndex(): Promise<Map<string, string>> {
  const { data, error } = await adminDb().from("categories").select("id, name, slug").range(0, 999);
  if (error) throw new Error(`categories: ${error.message}`);
  const index = new Map<string, string>();
  for (const row of data ?? []) {
    index.set(slugify(String(row.name)), String(row.id));
    if (row.slug) index.set(slugify(String(row.slug)), String(row.id));
  }
  return index;
}

/**
 * Only ever REUSES a category. New categories are not invented from a store's
 * taxonomy: that would quietly reshape the storefront's navigation, which is a
 * decision for the admin panel, not for a background job.
 */
function resolveCategory(index: Map<string, string>, categories: string[]): string | null {
  for (const name of categories) {
    const hit = index.get(slugify(name));
    if (hit) return hit;
  }
  return null;
}

function uniqueSlug(base: string, taken: Set<string>): string {
  const root = (base || "producto").slice(0, 70);
  if (!taken.has(root)) {
    taken.add(root);
    return root;
  }
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${root}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  const fallback = `${root}-${Date.now().toString(36)}`;
  taken.add(fallback);
  return fallback;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function iterateSource(
  options: RunOptions,
  startPage: number,
  onError: (stage: string, message: string) => void,
  onExhausted: () => void,
): AsyncGenerator<SourcePage, void, undefined> {
  if (options.source === "mawmaw") {
    return iterateMawMawProducts({
      maxPages: options.maxPages,
      startPage,
      withBrands: options.withBrands,
      onError,
      onExhausted,
    });
  }
  return iterateOskinProducts({ maxPages: options.maxPages, startPage, onError, onExhausted });
}

export async function runSync(options: RunOptions): Promise<RunResult> {
  const dryRun = options.dryRun ?? false;
  const startedAt = nowIso();
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const counters = emptyCounters();
  const errors = new ErrorLog();
  const priceMoves: PriceMove[] = [];
  const createdSamples: RunResult["createdSamples"] = [];
  const matchedByMethod: Record<string, number> = {};

  if (options.resetCursor) await resetSyncCursor(options.source);
  // A dry run must not consume the real checkpoint's position either: it reads
  // where the next real run would start, and never writes it back.
  const startPage = options.resetCursor ? FIRST_PAGE : await readStartPage(options.source);

  const index = await CatalogIndex.load();
  if (!index.productSourcesTableExists) {
    errors.add(
      "migracion",
      "La tabla product_sources no existe todavía. Aplica database/migrations/003_product_sources_sync.sql en el editor SQL de Supabase antes de sincronizar en modo escritura.",
    );
  }

  const canWrite = !dryRun && index.productSourcesTableExists;
  const runId = canWrite ? await openRun(options, errors) : null;

  const brandFor = makeBrandResolver(!canWrite);
  const categories = await loadCategoryIndex();
  const takenSlugs = new Set<string>();
  for (const product of index.products.values()) if (product.slug) takenSlugs.add(product.slug.toLowerCase());

  let truncated = false;
  let exhausted = false;
  const batch: SourceProduct[] = [];
  const imageBudget: ImageBudget = {
    // Image work is abandoned before the run's own deadline so the checkpoint
    // always gets written; see IMAGE_TAIL_MS.
    deadline: deadline - IMAGE_TAIL_MS,
    stored: 0,
    skipped: 0,
  };

  const flush = async () => {
    for (const product of batch) {
      try {
        await ingestProduct({
          product,
          index,
          counters,
          errors,
          priceMoves,
          createdSamples,
          matchedByMethod,
          brandFor,
          categories,
          takenSlugs,
          canWrite,
          runId,
          imageBudget,
        });
      } catch (error) {
        // One product can never end the run.
        errors.add(
          `${product.source}:ingest`,
          error instanceof Error ? error.message : String(error),
          product.externalProductId,
        );
      }
    }
    batch.length = 0;
    options.onProgress?.(counters);
  };

  // The last page that was read AND written in full. Only this advances the
  // checkpoint: a page abandoned half-way must be replayed, not skipped.
  let lastCompletedPage = 0;

  try {
    const pages = iterateSource(
      options,
      startPage,
      (stage, message) => errors.add(stage, message),
      () => {
        exhausted = true;
      },
    );

    for await (const page of pages) {
      for (const product of page.products) {
        counters.products_scanned += 1;
        batch.push(product);
        if (batch.length >= BATCH_SIZE) await flush();
        // Checked inside the page too: an Oskin page is 100 products and copying
        // their photos can outlast the budget on its own.
        if (Date.now() > deadline) {
          truncated = true;
          break;
        }
      }
      await flush();
      // A retry-pass page arrives out of order, so it proves nothing about how
      // far the forward crawl got and must not move the checkpoint.
      if (!truncated && !page.retry) lastCompletedPage = Math.max(lastCompletedPage, page.page);
      if (truncated || Date.now() > deadline) {
        truncated = true;
        break;
      }
    }
    await flush();
  } catch (error) {
    await flush();
    errors.add(`${options.source}:fatal`, error instanceof Error ? error.message : String(error));
  }

  // ---------------------------------------------------------------------------
  // Checkpoint
  // ---------------------------------------------------------------------------
  // Three outcomes, and they are not the same thing:
  //   truncated  -> ran out of time: resume at the page after the last complete
  //                 one (or replay the page that was cut in half).
  //   exhausted  -> reached the end of the catalogue: rewind to page 1 so the
  //                 next run detects changes instead of crawling past the end.
  //   neither    -> stopped at the caller's maxPages: advance, nothing is done.
  const wrapped = !truncated && exhausted;
  const nextPage = wrapped ? FIRST_PAGE : Math.max(startPage, lastCompletedPage + 1);
  let cursorSaved = false;

  // The notes appended below are the run's own narration, not faults, so the
  // status is decided from the errors that existed before them. Without this a
  // perfectly clean full pass would report itself "partial" for saying so.
  const realErrorCount = errors.total;

  if (canWrite) {
    cursorSaved = await writeSyncCursor(options.source, {
      page: nextPage,
      updatedAt: nowIso(),
      highWaterPage: wrapped ? 0 : Math.max(lastCompletedPage, startPage - 1),
      lastOutcome: truncated ? "truncated" : "completed",
    });
    if (!cursorSaved) {
      errors.add(
        `${options.source}:cursor`,
        "No fue posible guardar el avance del catálogo en app_settings; la siguiente corrida volverá a empezar desde la misma página.",
      );
    }
  }

  if (truncated) {
    errors.add(
      `${options.source}:presupuesto`,
      `Se alcanzó el límite de tiempo de la corrida (${Math.round((options.budgetMs ?? DEFAULT_BUDGET_MS) / 1000)}s) en la página ${lastCompletedPage || startPage} del catálogo. ` +
        (cursorSaved
          ? `La siguiente corrida continúa desde la página ${nextPage}.`
          : "La siguiente corrida volverá a empezar desde la misma página."),
    );
  } else if (wrapped) {
    errors.add(
      `${options.source}:catalogo`,
      `Se recorrió el catálogo completo hasta la página ${lastCompletedPage}. La siguiente corrida vuelve a empezar desde la página 1 para detectar cambios.`,
    );
  }

  if (imageBudget.skipped > 0) {
    errors.add(
      `${options.source}:imagenes`,
      `${imageBudget.skipped} producto(s) se guardaron sin foto porque se agotó el tiempo de la corrida. La siguiente pasada por esas páginas las completa.`,
    );
  }

  const status: SyncStatus =
    counters.products_scanned === 0 && realErrorCount > 0
      ? "failed"
      : truncated || realErrorCount > 0
        ? "partial"
        : "completed";

  const finishedAt = nowIso();
  if (canWrite && runId) await closeRun(runId, status, counters, errors, finishedAt);

  return {
    runId,
    source: options.source,
    syncType: options.syncType,
    status,
    startedAt,
    finishedAt,
    counters,
    errors: errors.items,
    priceMoves,
    createdSamples,
    matchedByMethod,
    dryRun: !canWrite,
    cursor: { startedAtPage: startPage, nextPage, wrapped, saved: cursorSaved },
    imagesStored: imageBudget.stored,
  };
}

async function openRun(options: RunOptions, errors: ErrorLog): Promise<string | null> {
  const { data, error } = await adminDb()
    .from("sync_runs")
    .insert({
      business_id: DEFAULT_BUSINESS_ID,
      source: options.source,
      sync_type: options.syncType,
      status: "running",
    })
    .select("id")
    .single();
  if (error) {
    errors.add("sync_runs", error.message);
    return null;
  }
  return String(data.id);
}

async function closeRun(
  runId: string,
  status: SyncStatus,
  counters: SyncCounters,
  errors: ErrorLog,
  finishedAt: string,
) {
  await adminDb()
    .from("sync_runs")
    .update({
      status,
      finished_at: finishedAt,
      ...counters,
      error_count: errors.total,
      errors: errors.items,
    })
    .eq("id", runId);
}

/** Shared across the whole run so photo work can be cut off as time runs out. */
type ImageBudget = { deadline: number; stored: number; skipped: number };

type IngestContext = {
  product: SourceProduct;
  index: CatalogIndex;
  counters: SyncCounters;
  errors: ErrorLog;
  priceMoves: PriceMove[];
  createdSamples: RunResult["createdSamples"];
  matchedByMethod: Record<string, number>;
  brandFor: BrandResolver;
  categories: Map<string, string>;
  takenSlugs: Set<string>;
  canWrite: boolean;
  runId: string | null;
  imageBudget: ImageBudget;
};

/**
 * Copies the storefront's photos for one product into our bucket and records
 * them in product_images.
 *
 * NOTHING HERE MAY THROW past this function. An image is the least important
 * thing the sync produces: a product without a photo is still a product we sell,
 * whereas an exception escaping here would abort the product entirely. Every
 * failure becomes a line in the run's error log, exactly like the rest of the
 * engine's per-product failures.
 */
async function storeImages(context: IngestContext, productId: string): Promise<number> {
  const { product, canWrite, errors, imageBudget } = context;
  // Dry run, or migration 003 missing: read the stores, write nothing.
  if (!canWrite) return 0;
  if (!imageCandidatesExist(product)) return 0;

  if (Date.now() > imageBudget.deadline) {
    imageBudget.skipped += 1;
    return 0;
  }

  try {
    const { stored, failures } = await copyProductImages(product, productId, MAX_PRODUCT_IMAGES);
    for (const failure of failures) {
      errors.add(`${product.source}:imagen`, failure, product.externalProductId);
    }
    if (!stored.length) return 0;

    const { error } = await adminDb()
      .from("product_images")
      .insert(stored.map((image) => ({ ...image, product_id: productId })));
    if (error) {
      errors.add(`${product.source}:imagen:insert`, error.message, product.externalProductId);
      return 0;
    }
    imageBudget.stored += stored.length;
    context.index.markHasImages(productId);
    return stored.length;
  } catch (error) {
    errors.add(
      `${product.source}:imagen`,
      error instanceof Error ? error.message : String(error),
      product.externalProductId,
    );
    return 0;
  }
}

function imageCandidatesExist(product: SourceProduct): boolean {
  return product.images.length > 0 || product.variants.some((variant) => variant.imageUrl);
}

async function ingestProduct(context: IngestContext) {
  const { product, index, counters, matchedByMethod } = context;
  const match = index.matchProduct(product);

  if (match.kind === "ambiguous") {
    counters.reviews_created += 1;
    // An empty candidate means the question is already open in the queue; do not
    // touch the row, or a re-run would reset what the admin is looking at.
    if (match.productId) {
      await queueReview(context, match.productId, match.candidateName, match.similarity, match.reason);
    }
    return;
  }

  if (match.kind === "new") {
    await createProduct(context);
    return;
  }

  counters.products_matched += 1;
  matchedByMethod[match.method] = (matchedByMethod[match.method] ?? 0) + 1;
  await reconcileProduct(context, match.productId, match.method);
}

/** Links an already-existing product and applies the price rule to its variants. */
async function reconcileProduct(context: IngestContext, productId: string, method: MatchMethod) {
  const { product, index, counters, priceMoves, canWrite, runId } = context;
  const existing = index.products.get(productId);
  let changed = false;

  for (const sourceVariant of product.variants) {
    const variantMatch = index.matchVariant(productId, product.source, product.externalProductId, sourceVariant);

    let variantId: string | null = null;
    if (variantMatch.kind === "matched") {
      const target = variantMatch.variant;
      variantId = target.id;
      const nextPrice = resolvePrice(target.price_cents, sourceVariant);
      if (nextPrice !== null) {
        priceMoves.push({
          productId,
          productName: existing?.name ?? product.name,
          variantId: target.id,
          variantName: target.name,
          oldPriceCents: target.price_cents,
          newPriceCents: nextPrice,
          source: product.source,
        });
        counters.prices_increased += 1;
        changed = true;
        if (canWrite) {
          await applyPriceIncrease(context, productId, target.id, target.price_cents, nextPrice, runId);
        }
        index.updateVariantPrice(target.id, productId, nextPrice);
      }
    } else {
      // The store sells an option we do not have yet: add the variant to the
      // product we already own instead of creating a second product for it.
      variantId = await createVariant(context, productId, sourceVariant);
      changed = true;
    }

    await upsertSourceLink(context, productId, variantId, sourceVariant, method);
  }

  // BACKFILL. A product matched here may have been created by an earlier run of
  // this very engine, back when it discarded the images it had already scraped -
  // 85 of the catalogue's imageless products came from exactly one such run. If
  // we still have no photo for it and the store is showing us one right now,
  // this is the moment to take it. Products that already have a photo are left
  // alone: the admin may have chosen it deliberately.
  if (!index.hasImages(productId)) {
    if ((await storeImages(context, productId)) > 0) changed = true;
  }

  if (changed) counters.products_updated += 1;
  else counters.products_unchanged += 1;
}

async function applyPriceIncrease(
  context: IngestContext,
  productId: string,
  variantId: string,
  oldPriceCents: number,
  newPriceCents: number,
  runId: string | null,
) {
  const { product, errors } = context;
  const update = await adminDb()
    .from("product_variants")
    .update({ price_cents: newPriceCents, updated_at: nowIso() })
    .eq("id", variantId);
  if (update.error) {
    errors.add("precio:update", update.error.message, product.externalProductId);
    return;
  }
  const log = await adminDb().from("price_change_log").insert({
    business_id: DEFAULT_BUSINESS_ID,
    product_id: productId,
    variant_id: variantId,
    old_price_cents: oldPriceCents,
    new_price_cents: newPriceCents,
    source_that_caused_change: product.source,
    sync_run_id: runId,
  });
  if (log.error) errors.add("precio:log", log.error.message, product.externalProductId);
}

async function createProduct(context: IngestContext) {
  const { product, index, counters, createdSamples, brandFor, categories, takenSlugs, canWrite } = context;
  counters.products_created += 1;

  const usable = product.variants.filter((variant) => !variant.needsPriceReview);
  const firstPrice = usable[0]?.priceCents ?? null;
  if (createdSamples.length < 25) {
    createdSamples.push({ name: product.name, url: product.url, priceCents: firstPrice });
  }

  const slug = uniqueSlug(slugify(product.name), takenSlugs);

  if (!canWrite) {
    // Dry run: keep the in-memory index consistent so a product that appears
    // twice in the same crawl is not counted as "created" twice.
    const pseudoId = `dry:${product.source}:${product.externalProductId}`;
    index.registerProduct({ id: pseudoId, name: product.name, slug, brand_id: null, brandName: product.brand, is_active: true });
    index.registerLink(product.source, product.externalProductId, pseudoId);
    for (const variant of product.variants) {
      index.registerVariant({
        id: `${pseudoId}:${variant.externalVariantId}`,
        product_id: pseudoId,
        name: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        price_cents: variant.priceCents ?? 0,
        is_active: true,
      });
    }
    return;
  }

  const brandId = await brandFor(product.brand);
  const insert = await adminDb()
    .from("products")
    .insert({
      name: product.name,
      slug,
      description: product.description ?? product.shortDescription ?? null,
      relevant_information: product.shortDescription ?? null,
      catalog_type: product.onDemand ? "ON_DEMAND" : "IMMEDIATE",
      brand_id: brandId,
      category_id: resolveCategory(categories, product.categories),
      // Published only when we actually know what to charge for it.
      is_public: usable.length > 0,
      is_active: true,
    })
    .select("id")
    .single();

  if (insert.error) {
    context.errors.add("producto:insert", insert.error.message, product.externalProductId);
    counters.products_created -= 1;
    return;
  }

  const productId = String(insert.data.id);
  index.registerProduct({ id: productId, name: product.name, slug, brand_id: brandId, brandName: product.brand, is_active: true });
  index.registerLink(product.source, product.externalProductId, productId);

  for (const variant of product.variants) {
    const variantId = await createVariant(context, productId, variant);
    await upsertSourceLink(context, productId, variantId, variant, "created");
  }

  // Last, and deliberately so: the product and its variants are already safe in
  // the database before the slowest, most failure-prone step begins.
  await storeImages(context, productId);
}

async function createVariant(
  context: IngestContext,
  productId: string,
  variant: SourceVariant,
): Promise<string | null> {
  const { index, canWrite, errors, product } = context;
  const priceCents = variant.needsPriceReview ? 0 : (variant.priceCents ?? 0);

  if (!canWrite) {
    const pseudoId = `dry:${product.source}:${product.externalProductId}:${variant.externalVariantId}`;
    index.registerVariant({
      id: pseudoId,
      product_id: productId,
      name: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      price_cents: priceCents,
      is_active: true,
    });
    return pseudoId;
  }

  // product_variants has UNIQUE (product_id, name): a store that repeats an
  // option label would otherwise abort the insert.
  const existingNames = new Set(index.variantsOf(productId).map((row) => row.name.toLowerCase()));
  let name = variant.name;
  for (let suffix = 2; existingNames.has(name.toLowerCase()) && suffix < 100; suffix += 1) {
    name = `${variant.name} (${suffix})`;
  }

  const insert = await adminDb()
    .from("product_variants")
    .insert({
      product_id: productId,
      name,
      // SKU is left null on purpose: product_variants.sku is globally UNIQUE and
      // neither store publishes a trustworthy one. The link to the store row
      // lives in product_sources, which is the right place for it.
      sku: null,
      attributes: variant.attributes,
      price_cents: priceCents,
      is_active: true,
    })
    .select("id")
    .single();

  if (insert.error) {
    errors.add("variante:insert", insert.error.message, product.externalProductId);
    return null;
  }

  const variantId = String(insert.data.id);
  index.registerVariant({
    id: variantId,
    product_id: productId,
    name,
    sku: null,
    barcode: variant.barcode,
    price_cents: priceCents,
    is_active: true,
  });
  return variantId;
}

async function upsertSourceLink(
  context: IngestContext,
  productId: string,
  variantId: string | null,
  variant: SourceVariant,
  method: MatchMethod,
) {
  const { product, canWrite, errors, runId } = context;
  if (!canWrite) return;

  const timestamp = nowIso();
  const row = {
    business_id: DEFAULT_BUSINESS_ID,
    product_id: productId,
    variant_id: variantId && !variantId.startsWith("dry:") ? variantId : null,
    source: product.source,
    external_product_id: product.externalProductId,
    external_variant_id: variant.externalVariantId,
    external_url: product.url,
    external_name: product.rawName || product.name,
    external_brand: product.brand,
    external_sku: variant.sku,
    external_barcode: variant.barcode,
    source_price_cents: variant.priceCents,
    source_regular_price_cents: variant.regularPriceCents,
    source_sale_price_cents: variant.salePriceCents,
    availability: variant.availability,
    match_method: method,
    needs_price_review: variant.needsPriceReview,
    last_seen_at: timestamp,
    last_synced_at: timestamp,
    last_sync_run_id: runId,
    updated_at: timestamp,
  };

  const { error } = await adminDb()
    .from("product_sources")
    .upsert(row, { onConflict: "source,external_product_id,external_variant_id" });
  if (error) errors.add("product_sources:upsert", error.message, product.externalProductId);
}

async function queueReview(
  context: IngestContext,
  candidateProductId: string,
  candidateName: string,
  similarity: number,
  reason: string,
) {
  const { product, canWrite, errors, runId } = context;
  if (!canWrite) return;

  const first = product.variants[0];
  const { error } = await adminDb()
    .from("product_match_reviews")
    .upsert(
      {
        business_id: DEFAULT_BUSINESS_ID,
        source: product.source,
        external_product_id: product.externalProductId,
        external_variant_id: "",
        external_url: product.url,
        external_name: product.rawName || product.name,
        external_brand: product.brand,
        external_price_cents: first?.priceCents ?? null,
        candidate_product_id: candidateProductId,
        candidate_name: candidateName,
        similarity: Number(similarity.toFixed(4)),
        reason,
        payload: product as unknown as Record<string, unknown>,
        sync_run_id: runId,
        updated_at: nowIso(),
      },
      // ignoreDuplicates: a question that already exists keeps its status and its
      // resolution. Re-running the sync must never reopen a settled decision.
      { onConflict: "source,external_product_id,external_variant_id", ignoreDuplicates: true },
    );
  if (error) errors.add("revision:upsert", error.message, product.externalProductId);
}

export function describeSource(source: SyncSource) {
  return SOURCE_LABELS[source];
}
