// Acciones masivas (Inventario y Productos). Business rules live here and take
// the admin id explicitly, so they can be exercised without a browser session;
// app/admin/productos/bulk-actions.ts only checks the OWNER session.
//
// Every write goes through the same functions the single-row controls use
// (updateVariantQuick for prices, setProductPublic for Visible/Oculto) or, for
// plain column changes (archive, category, brand), through updates batched in
// groups of STOCK_BATCH_SIZE ids so PostgREST URLs stay short.

import { describeError } from "../actions";
import {
  BULK_CHUNK_SIZE,
  BULK_INSPECT_CHUNK,
  BULK_SELECTION_CAP,
  UUID_PATTERN,
  chunkList,
  computeBulkPrice,
  isValidBulkPriceParams,
  type BulkActionKind,
  type BulkChunkResult,
  type BulkFilter,
  type BulkItemIssue,
  type BulkPriceParams,
  type BulkScope,
} from "../bulk";
import {
  PRICE_CHANGED_MEANWHILE_MESSAGE,
  PUBLISH_NEEDS_PRICE_MESSAGE,
  STOCK_BATCH_SIZE,
  applyProductFilters,
  applyProductSegment,
  getStockFor,
  isProductSegment,
  runProductSegmentQuery,
  setProductPublic,
  updateVariantQuick,
} from "./admin-catalog";
import { adminDb } from "./business";
import { IN_TRANSIT_UNAVAILABLE_MESSAGE } from "./in-transit";

/** Parallel requests per batch: fast enough for 5,000 units, gentle with PostgREST. */
const POOL_SIZE = 6;

const MISSING_REASON = "Ya no existe (se borró o cambió).";
export const NEEDS_PRICE_TO_PUBLISH_REASON = "Ponle un precio antes de publicarlo.";

async function mapPool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function uniqueIds(ids: readonly unknown[]): string[] {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function relationRow<T>(value: unknown): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) as T;
}

// ---------------------------------------------------------------------------
// Loading what was selected (always batched, always read now — never trusted from the page)
// ---------------------------------------------------------------------------

type LoadedVariant = { id: string; name: string; price_cents: number; is_active: boolean };

type LoadedProduct = {
  id: string;
  name: string;
  is_active: boolean;
  is_public: boolean;
  category_id: string | null;
  brand_id: string | null;
  variants: LoadedVariant[];
};

async function loadProducts(productIds: readonly string[]): Promise<Map<string, LoadedProduct>> {
  const map = new Map<string, LoadedProduct>();
  for (const batch of chunkList(productIds, STOCK_BATCH_SIZE)) {
    const { data, error } = await adminDb()
      .from("products")
      .select("id, name, is_active, is_public, category_id, brand_id, product_variants(id, name, price_cents, is_active)")
      .in("id", batch);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Array<Omit<LoadedProduct, "variants"> & { product_variants: LoadedVariant[] | null }>) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        is_active: Boolean(row.is_active),
        is_public: Boolean(row.is_public),
        category_id: row.category_id ?? null,
        brand_id: row.brand_id ?? null,
        variants: (row.product_variants ?? []).map((variant) => ({
          id: variant.id,
          name: variant.name,
          price_cents: Number(variant.price_cents ?? 0),
          is_active: Boolean(variant.is_active),
        })),
      });
    }
  }
  return map;
}

type LoadedVariantRow = LoadedVariant & { product_id: string; productName: string; productActive: boolean };

async function loadVariants(variantIds: readonly string[]): Promise<Map<string, LoadedVariantRow>> {
  const map = new Map<string, LoadedVariantRow>();
  for (const batch of chunkList(variantIds, STOCK_BATCH_SIZE)) {
    const { data, error } = await adminDb()
      .from("product_variants")
      .select("id, name, product_id, price_cents, is_active, products(name, is_active)")
      .in("id", batch);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Array<LoadedVariant & { product_id: string; products: unknown }>) {
      const product = relationRow<{ name: string; is_active: boolean }>(row.products);
      map.set(row.id, {
        id: row.id,
        name: row.name,
        product_id: row.product_id,
        price_cents: Number(row.price_cents ?? 0),
        is_active: Boolean(row.is_active),
        productName: product?.name ?? "Producto",
        productActive: Boolean(product?.is_active),
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// "Seleccionar los N resultados": the server resolves the ids with the list's own filters
// ---------------------------------------------------------------------------

export type BulkResolveResult =
  | { ok: true; ids: string[]; productCount: number }
  | { ok: false; error: string; total?: number };

function sanitizeFilter(filter: BulkFilter | null | undefined): BulkFilter {
  const raw = (filter ?? {}) as Record<string, unknown>;
  const search = typeof raw.search === "string" ? raw.search.trim().slice(0, 120) : "";
  const categoryId = typeof raw.categoryId === "string" && UUID_PATTERN.test(raw.categoryId) ? raw.categoryId : undefined;
  const stockFilter = raw.stockFilter === "out" || raw.stockFilter === "low" ? raw.stockFilter : "all";
  return {
    search: search || undefined,
    categoryId,
    includeArchived: raw.includeArchived === true,
    segment: isProductSegment(raw.segment) ? raw.segment : undefined,
    stockFilter,
  };
}

function tooManyMessage(total: number, unit: string) {
  return `Son ${total.toLocaleString("es-MX")} ${unit}; una acción masiva puede abarcar como máximo ${BULK_SELECTION_CAP.toLocaleString(
    "es-MX",
  )}. Afina la búsqueda o filtra por categoría.`;
}

/**
 * Every id matching the list's filters, across all pages. scope "products"
 * returns product ids; scope "variants" (Inventario) returns the active
 * variants of the matching products, with the Sin stock / Stock bajo filter
 * applied over ALL pages (same per-product rule as the list).
 */
export async function resolveBulkSelection(input: { scope: BulkScope; filter: BulkFilter }): Promise<BulkResolveResult> {
  const scope: BulkScope = input.scope === "variants" ? "variants" : "products";
  const filter = sanitizeFilter(input.filter);
  const PAGE = 1000;
  type Row = { id: string; product_variants?: Array<{ id: string; is_active: boolean; min_quantity: number | null }> };
  const rows: Row[] = [];

  for (let from = 0; ; from += PAGE) {
    const run = (filterInTransit: boolean) => {
      let builder = adminDb()
        .from("products")
        .select(scope === "variants" ? "id, product_variants(id, is_active, min_quantity)" : "id", { count: "exact" });
      builder = applyProductFilters(builder, filter);
      builder = applyProductSegment(builder, scope === "products" ? filter.segment : undefined, filterInTransit);
      return builder.order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, from + PAGE - 1);
    };
    const { result, unavailable } = await runProductSegmentQuery(scope === "products" ? filter.segment : undefined, run);
    if (unavailable) return { ok: false, error: IN_TRANSIT_UNAVAILABLE_MESSAGE };
    if (result.error) return { ok: false, error: describeError(new Error(result.error.message), "No fue posible leer la lista.") };
    const total = result.count ?? 0;
    if (total > BULK_SELECTION_CAP) return { ok: false, error: tooManyMessage(total, "productos"), total };
    const page = (result.data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE || rows.length >= total) break;
  }

  if (scope === "products") {
    const ids = uniqueIds(rows.map((row) => row.id));
    return { ok: true, ids, productCount: ids.length };
  }

  let products = rows.map((row) => ({
    id: row.id,
    variants: (row.product_variants ?? []).filter((variant) => variant.is_active),
  }));
  if (filter.stockFilter && filter.stockFilter !== "all") {
    const stock = await getStockFor(products.flatMap((product) => product.variants.map((variant) => variant.id)));
    products = products.filter((product) => {
      const total = product.variants.reduce((sum, variant) => sum + (stock.get(variant.id) ?? 0), 0);
      const minimum = product.variants.reduce((sum, variant) => sum + Number(variant.min_quantity ?? 0), 0);
      return filter.stockFilter === "out" ? total <= 0 : total > 0 && minimum > 0 && total <= minimum;
    });
  }
  const ids = uniqueIds(products.flatMap((product) => product.variants.map((variant) => variant.id)));
  if (ids.length > BULK_SELECTION_CAP) return { ok: false, error: tooManyMessage(ids.length, "filas (variantes)"), total: ids.length };
  return { ok: true, ids, productCount: products.filter((product) => product.variants.length).length };
}

// ---------------------------------------------------------------------------
// Counting / mapping a selection before confirming
// ---------------------------------------------------------------------------

export type BulkUnitsInfo = {
  ok: true;
  /** product id -> number of ACTIVE variants (the client sums it after merging chunks). */
  products: Record<string, number>;
  /** Selected variant rows that still exist (scope "variants"). */
  variantRows: number;
  /** Selected ids that no longer exist. */
  missing: number;
};

function readIds(ids: unknown, max: number): string[] | null {
  if (!Array.isArray(ids)) return null;
  const clean = uniqueIds(ids);
  if (!clean.length || clean.length > max || clean.some((id) => !UUID_PATTERN.test(id))) return null;
  return clean;
}

/** How many products (and their active variants) a selection covers; also maps Inventario rows to their products. */
export async function countBulkUnits(input: { scope: BulkScope; ids: unknown }): Promise<BulkUnitsInfo | { ok: false; error: string }> {
  const ids = readIds(input.ids, BULK_INSPECT_CHUNK);
  if (!ids) return { ok: false, error: "Selección no válida." };
  try {
    let productIds = ids;
    let variantRows = 0;
    let missing = 0;
    if (input.scope === "variants") {
      const variants = await loadVariants(ids);
      variantRows = variants.size;
      missing = ids.length - variants.size;
      productIds = uniqueIds([...variants.values()].map((variant) => variant.product_id));
    }
    const products = await loadProducts(productIds);
    if (input.scope !== "variants") missing = ids.length - products.size;
    const map: Record<string, number> = {};
    for (const product of products.values()) map[product.id] = product.variants.filter((variant) => variant.is_active).length;
    return { ok: true, products: map, variantRows, missing };
  } catch (error) {
    return { ok: false, error: describeError(error, "No fue posible revisar la selección.") };
  }
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/**
 * One unit of a price change. Productos (and Inventario's "todas las variantes
 * de los productos seleccionados"): a product with ALL its active variants —
 * changed all together or not at all. Inventario: one selected variant.
 */
type PriceGroup = { key: string; name: string; skip?: string; variants: Array<{ id: string; name: string; price: number }> };

async function buildPriceGroups(scope: BulkScope, ids: string[]): Promise<PriceGroup[]> {
  if (scope === "variants") {
    const variants = await loadVariants(ids);
    return ids.map((id) => {
      const variant = variants.get(id);
      if (!variant) return { key: id, name: "Variante", skip: MISSING_REASON, variants: [] };
      const name = `${variant.productName} · ${variant.name}`;
      if (!variant.productActive) return { key: id, name, skip: "Producto archivado: restáuralo para cambiarle el precio.", variants: [] };
      if (!variant.is_active) return { key: id, name, skip: "Variante desactivada.", variants: [] };
      return { key: id, name, variants: [{ id: variant.id, name: variant.name, price: variant.price_cents }] };
    });
  }
  const products = await loadProducts(ids);
  return ids.map((id) => {
    const product = products.get(id);
    if (!product) return { key: id, name: "Producto", skip: MISSING_REASON, variants: [] };
    if (!product.is_active) return { key: id, name: product.name, skip: "Producto archivado: restáuralo para cambiarle el precio.", variants: [] };
    const active = product.variants.filter((variant) => variant.is_active);
    if (!active.length) return { key: id, name: product.name, skip: "No tiene variantes activas.", variants: [] };
    return { key: id, name: product.name, variants: active.map((variant) => ({ id: variant.id, name: variant.name, price: variant.price_cents })) };
  });
}

type PlannedGroup =
  | { kind: "skip"; reason: string }
  | { kind: "apply"; changes: Array<{ id: string; name: string; previous: number; next: number }>; all: Array<{ id: string; name: string; previous: number; next: number }> };

function planGroup(group: PriceGroup, params: BulkPriceParams): PlannedGroup {
  if (group.skip) return { kind: "skip", reason: group.skip };
  const all: Array<{ id: string; name: string; previous: number; next: number }> = [];
  for (const variant of group.variants) {
    const outcome = computeBulkPrice(variant.price, params);
    if (!outcome.ok) {
      const reason = group.variants.length > 1 ? `Variante "${variant.name}": ${outcome.reason} No se cambió ninguna variante.` : outcome.reason;
      return { kind: "skip", reason };
    }
    all.push({ id: variant.id, name: variant.name, previous: variant.price, next: outcome.next });
  }
  const changes = all.filter((change) => change.next !== change.previous);
  if (!changes.length) return { kind: "skip", reason: "Ya tenía ese precio." };
  return { kind: "apply", changes, all };
}

export type BulkPriceExample = {
  name: string;
  variants: Array<{ name: string; before: number; after: number | null }>;
  reason?: string;
};

/** Up to 3 "antes → después" examples, including a multi-variant product when the sample has one. */
export async function previewBulkPrice(input: {
  scope: BulkScope;
  ids: unknown;
  params: unknown;
}): Promise<{ ok: true; examples: BulkPriceExample[] } | { ok: false; error: string }> {
  const ids = readIds(input.ids, 60);
  if (!ids) return { ok: false, error: "Selección no válida." };
  if (!isValidBulkPriceParams(input.params)) return { ok: false, error: "Revisa los datos del cambio de precio." };
  const params = input.params;
  try {
    const groups = await buildPriceGroups(input.scope === "variants" ? "variants" : "products", ids);
    const toExample = (group: PriceGroup): BulkPriceExample => {
      const plan = planGroup(group, params);
      return {
        name: group.name,
        reason: plan.kind === "skip" ? plan.reason : undefined,
        variants: group.variants.slice(0, 4).map((variant) => {
          const outcome = computeBulkPrice(variant.price, params);
          return { name: variant.name, before: variant.price, after: outcome.ok ? outcome.next : null };
        }),
      };
    };
    const applicable = groups.filter((group) => planGroup(group, params).kind === "apply");
    const picked = (applicable.length ? applicable : groups).slice(0, 3);
    const multi = applicable.find((group) => group.variants.length > 1);
    if (multi && !picked.includes(multi)) picked[Math.min(picked.length, 3) - 1] = multi;
    const skipped = groups.find((group) => planGroup(group, params).kind === "skip");
    const examples = picked.map(toExample);
    if (applicable.length && skipped && examples.length < 4) examples.push(toExample(skipped));
    return { ok: true, examples };
  } catch (error) {
    return { ok: false, error: describeError(error, "No fue posible calcular la vista previa.") };
  }
}

type GroupOutcome =
  | { status: "updated"; written: Array<{ id: string; previous: number; next: number }> }
  | { status: "omitted"; reason: string }
  | { status: "error"; reason: string };

/**
 * Writes one product's (or one variant's) new prices through updateVariantQuick
 * with a compare-and-set on the price read now. All or nothing per product: if
 * one variant cannot be written, the variants already written go back to their
 * previous price (again compare-and-set, so a newer edit is never overwritten).
 */
async function applyPriceGroup(
  changes: Array<{ id: string; name: string; previous: number; next: number }>,
  adminId: string,
): Promise<GroupOutcome> {
  const written: Array<{ id: string; name: string; previous: number; next: number }> = [];
  for (const change of changes) {
    const result = await updateVariantQuick({
      variantId: change.id,
      field: "price",
      value: change.next,
      adminId,
      expectedPriceCents: change.previous,
    });
    if (result.ok && result.changed) {
      written.push(change);
      continue;
    }
    const failure = result.ok ? "No se pudo guardar el precio." : result.error;
    const notReverted: string[] = [];
    for (const done of [...written].reverse()) {
      const undo = await updateVariantQuick({
        variantId: done.id,
        field: "price",
        value: done.previous,
        adminId,
        expectedPriceCents: done.next,
      });
      if (!undo.ok) notReverted.push(done.name);
    }
    const label = changes.length > 1 ? `Variante "${change.name}": ` : "";
    if (notReverted.length) {
      return {
        status: "error",
        reason: `${label}${failure} No se pudo regresar el precio anterior de: ${notReverted.join(", ")}. Revisa el producto.`,
      };
    }
    const expected =
      failure === PRICE_CHANGED_MEANWHILE_MESSAGE ||
      failure.includes("archivado") ||
      failure.includes("desactivada") ||
      failure.includes("no encontrad");
    const suffix = changes.length > 1 ? " No se cambió ninguna variante." : "";
    return expected ? { status: "omitted", reason: `${label}${failure}${suffix}` } : { status: "error", reason: `${label}${failure}${suffix}` };
  }
  return { status: "updated", written };
}

// ---------------------------------------------------------------------------
// Idempotency ledger: one activity_logs row per (operation token, batch)
// ---------------------------------------------------------------------------

const LEDGER_ENTITY_TYPE = "bulk_operation";

const LEDGER_ACTION: Record<BulkActionKind, string> = {
  price: "PRODUCT_BULK_PRICE",
  hide: "PRODUCT_BULK_HIDDEN",
  show: "PRODUCT_BULK_PUBLISHED",
  archive: "PRODUCT_BULK_ARCHIVED",
  restore: "PRODUCT_BULK_RESTORED",
  category: "PRODUCT_BULK_CATEGORY",
  brand: "PRODUCT_BULK_BRAND",
};

type Claim = { kind: "claimed"; logId: number } | { kind: "replay"; result: BulkChunkResult } | { kind: "busy" } | { kind: "failed"; error: string };

type LedgerRow = { id: number; new_data: { status?: string; result?: BulkChunkResult } | null };

async function readLedger(key: string): Promise<LedgerRow | null> {
  const { data, error } = await adminDb()
    .from("activity_logs")
    .select("id, new_data")
    .eq("entity_type", LEDGER_ENTITY_TYPE)
    .eq("entity_id", key)
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as LedgerRow | undefined) ?? null;
}

function fromLedger(row: LedgerRow): Claim {
  if (row.new_data?.status === "DONE" && row.new_data.result?.ok) return { kind: "replay", result: { ...row.new_data.result, replay: true } };
  return { kind: "busy" };
}

/**
 * Claims a batch before touching anything. A repeated request with the same
 * token and batch number (double click, network retry) finds the first claim
 * and gets its stored result back instead of applying the change again.
 */
async function claimBatch(input: {
  adminId: string;
  kind: BulkActionKind;
  key: string;
  details: Record<string, unknown>;
}): Promise<Claim> {
  try {
    const existing = await readLedger(input.key);
    if (existing) return fromLedger(existing);
    const { data, error } = await adminDb()
      .from("activity_logs")
      .insert({
        admin_user_id: input.adminId,
        action: LEDGER_ACTION[input.kind],
        entity_type: LEDGER_ENTITY_TYPE,
        entity_id: input.key,
        new_data: { status: "RUNNING", ...input.details },
      })
      .select("id")
      .single();
    if (error || !data) return { kind: "failed", error: `No se pudo registrar la operación; no se cambió nada. ${error?.message ?? ""}`.trim() };
    const logId = Number(data.id);
    const first = await readLedger(input.key);
    if (first && Number(first.id) !== logId) {
      // Two identical requests raced: the earlier row wins, this one steps back.
      await adminDb().from("activity_logs").delete().eq("id", logId);
      return fromLedger(first);
    }
    return { kind: "claimed", logId };
  } catch (error) {
    return { kind: "failed", error: describeError(error, "No se pudo registrar la operación; no se cambió nada.") };
  }
}

const MAX_LOGGED_ISSUES = 300;

async function finishBatch(logId: number, details: Record<string, unknown>, result: BulkChunkResult, changedIds: string[]) {
  try {
    await adminDb()
      .from("activity_logs")
      .update({
        new_data: {
          status: "DONE",
          ...details,
          changedIds: changedIds.slice(0, BULK_CHUNK_SIZE.restore * 4),
          result: result.ok
            ? { ...result, omitted: result.omitted.slice(0, MAX_LOGGED_ISSUES), errors: result.errors.slice(0, MAX_LOGGED_ISSUES) }
            : result,
        },
      })
      .eq("id", logId);
  } catch {
    // The batch already ran; failing to close its log must not hide its result.
  }
}

type ItemLog = { action: string; entityType: string; entityId: string; previousData?: unknown; newData?: unknown };

/** Per-product / per-variant audit rows, inserted in a few batched requests (same table as logActivity). */
async function insertItemLogs(adminId: string, key: string, logs: ItemLog[]) {
  for (const batch of chunkList(logs, 500)) {
    try {
      await adminDb()
        .from("activity_logs")
        .insert(
          batch.map((log) => ({
            admin_user_id: adminId,
            action: log.action,
            entity_type: log.entityType,
            entity_id: log.entityId,
            previous_data: log.previousData ?? null,
            new_data: { ...((log.newData as Record<string, unknown>) ?? {}), bulk: key },
          })),
        );
    } catch {
      // Auditing must never block the operation the user asked for.
    }
  }
}

// ---------------------------------------------------------------------------
// Running one batch
// ---------------------------------------------------------------------------

export type BulkChunkInput = {
  adminId: string;
  kind: BulkActionKind;
  /** "variants" only for kind "price" from Inventario (one row = one variant). Everything else works on product ids. */
  scope: BulkScope;
  ids: unknown;
  /** Random id created when she confirms; identical for every batch of the same operation. */
  token: string;
  chunkIndex: number;
  totalChunks: number;
  price?: unknown;
  categoryId?: unknown;
  brandName?: unknown;
};

const KINDS: readonly BulkActionKind[] = ["price", "hide", "show", "archive", "restore", "category", "brand"];

export async function runBulkChunk(input: BulkChunkInput): Promise<BulkChunkResult> {
  const { adminId, kind } = input;
  if (!KINDS.includes(kind)) return { ok: false, error: "Acción no válida." };
  const scope: BulkScope = input.scope === "variants" ? "variants" : "products";
  if (scope === "variants" && kind !== "price") return { ok: false, error: "Esta acción se aplica por producto." };
  const ids = readIds(input.ids, BULK_CHUNK_SIZE[kind]);
  if (!ids) return { ok: false, error: "Selección no válida (vacía o demasiado grande para un lote)." };
  if (typeof input.token !== "string" || !UUID_PATTERN.test(input.token)) return { ok: false, error: "Operación no válida." };
  const maxChunks = Math.ceil(BULK_SELECTION_CAP / BULK_CHUNK_SIZE[kind]) + 1;
  if (
    !Number.isInteger(input.chunkIndex) ||
    !Number.isInteger(input.totalChunks) ||
    input.chunkIndex < 0 ||
    input.totalChunks < 1 ||
    input.chunkIndex >= input.totalChunks ||
    input.totalChunks > maxChunks
  ) {
    return { ok: false, error: "Lote no válido." };
  }

  // Validate the target value BEFORE claiming, so a bad request costs nothing.
  let price: BulkPriceParams | null = null;
  let categoryId: string | null = null;
  let brand: { id: string; name: string } | null = null;
  try {
    if (kind === "price") {
      if (!isValidBulkPriceParams(input.price)) return { ok: false, error: "Revisa los datos del cambio de precio." };
      price = input.price;
    }
    if (kind === "category") {
      const id = String(input.categoryId ?? "");
      if (!UUID_PATTERN.test(id)) return { ok: false, error: "Elige una categoría." };
      const { data, error } = await adminDb().from("categories").select("id, is_active").eq("id", id).maybeSingle();
      if (error) return { ok: false, error: describeError(new Error(error.message), "No fue posible leer la categoría.") };
      if (!data || !data.is_active) return { ok: false, error: "Esa categoría no existe o está desactivada." };
      categoryId = id;
    }
    if (kind === "brand") {
      const name = String(input.brandName ?? "").trim();
      if (!name || name.length > 120) return { ok: false, error: "Elige una marca de la lista." };
      // brands.name is citext: the comparison ignores upper/lower case. Only existing brands.
      const { data, error } = await adminDb().from("brands").select("id, name").eq("name", name).limit(1);
      if (error) return { ok: false, error: describeError(new Error(error.message), "No fue posible leer las marcas.") };
      const row = (data ?? [])[0] as { id: string; name: string } | undefined;
      if (!row) return { ok: false, error: `La marca "${name}" no existe. Elige una de la lista.` };
      brand = row;
    }
  } catch (error) {
    return { ok: false, error: describeError(error, "No fue posible validar la acción.") };
  }

  const key = `${input.token}:${input.chunkIndex}`;
  const details = {
    kind,
    scope,
    chunk: input.chunkIndex + 1,
    totalChunks: input.totalChunks,
    requested: ids.length,
    price,
    categoryId,
    brandId: brand?.id ?? null,
  };
  const claim = await claimBatch({ adminId, kind, key, details });
  if (claim.kind === "replay") return claim.result;
  if (claim.kind === "busy") return { ok: false, error: "Este lote ya se está aplicando (doble envío). Espera el resultado; no se aplicará dos veces." };
  if (claim.kind === "failed") return { ok: false, error: claim.error };

  let result: BulkChunkResult;
  let changedIds: string[] = [];
  try {
    const outcome =
      kind === "price"
        ? await runPrice(scope, ids, price as BulkPriceParams, adminId, key)
        : kind === "hide" || kind === "show"
          ? await runVisibility(ids, kind === "show", adminId, key)
          : kind === "archive" || kind === "restore"
            ? await runActive(ids, kind === "restore", adminId, key)
            : await runColumn(ids, kind === "category" ? "category_id" : "brand_id", (kind === "category" ? categoryId : brand?.id) as string, adminId, key);
    result = outcome.result;
    changedIds = outcome.changedIds;
  } catch (error) {
    result = { ok: false, error: describeError(error, "No fue posible aplicar la acción.") };
  }
  await finishBatch(claim.logId, details, result, changedIds);
  return result;
}

type BatchOutcome = { result: BulkChunkResult; changedIds: string[] };

function done(updated: number, variantsUpdated: number, omitted: BulkItemIssue[], errors: BulkItemIssue[]): BulkChunkResult {
  return { ok: true, updated, variantsUpdated, omitted, errors, replay: false };
}

async function runPrice(scope: BulkScope, ids: string[], params: BulkPriceParams, adminId: string, key: string): Promise<BatchOutcome> {
  const groups = await buildPriceGroups(scope, ids);
  const omitted: BulkItemIssue[] = [];
  const errors: BulkItemIssue[] = [];
  const logs: ItemLog[] = [];
  const changedIds: string[] = [];
  let updated = 0;
  let variantsUpdated = 0;

  const outcomes = await mapPool(groups, POOL_SIZE, async (group) => {
    const plan = planGroup(group, params);
    if (plan.kind === "skip") return { group, outcome: { status: "omitted", reason: plan.reason } as GroupOutcome };
    return { group, outcome: await applyPriceGroup(plan.changes, adminId) };
  });

  for (const { group, outcome } of outcomes) {
    if (outcome.status === "omitted") omitted.push({ id: group.key, name: group.name, reason: outcome.reason });
    else if (outcome.status === "error") errors.push({ id: group.key, name: group.name, reason: outcome.reason });
    else {
      updated += 1;
      variantsUpdated += outcome.written.length;
      changedIds.push(group.key);
      for (const change of outcome.written) {
        logs.push({
          action: "PRODUCT_PRICE_BULK_EDIT",
          entityType: "product_variants",
          entityId: change.id,
          previousData: { price_cents: change.previous },
          newData: { price_cents: change.next, mode: params.mode, value: params.value, rounding: params.rounding },
        });
      }
    }
  }
  await insertItemLogs(adminId, key, logs);
  return { result: done(updated, variantsUpdated, omitted, errors), changedIds };
}

async function runVisibility(ids: string[], isPublic: boolean, adminId: string, key: string): Promise<BatchOutcome> {
  const products = await loadProducts(ids);
  const omitted: BulkItemIssue[] = [];
  const errors: BulkItemIssue[] = [];
  const candidates: LoadedProduct[] = [];
  for (const id of ids) {
    const product = products.get(id);
    if (!product) omitted.push({ id, name: "Producto", reason: MISSING_REASON });
    else if (!product.is_active) {
      omitted.push({
        id,
        name: product.name,
        reason: isPublic ? "Producto archivado: restáuralo para publicarlo." : "Producto archivado (ya no aparece en el catálogo).",
      });
    } else if (product.is_public === isPublic) omitted.push({ id, name: product.name, reason: isPublic ? "Ya estaba visible." : "Ya estaba oculto." });
    else if (isPublic && !product.variants.some((variant) => variant.is_active && variant.price_cents > 0)) {
      omitted.push({ id, name: product.name, reason: NEEDS_PRICE_TO_PUBLISH_REASON });
    } else candidates.push(product);
  }

  const results = await mapPool(candidates, POOL_SIZE, (product) => setProductPublic({ productId: product.id, isPublic }));
  const changedIds: string[] = [];
  const logs: ItemLog[] = [];
  results.forEach((result, index) => {
    const product = candidates[index];
    if (result.ok && result.changed) {
      changedIds.push(product.id);
      logs.push({
        action: isPublic ? "PRODUCT_PUBLISHED" : "PRODUCT_HIDDEN",
        entityType: "products",
        entityId: product.id,
        previousData: { is_public: result.previous },
        newData: { is_public: result.next },
      });
    } else if (result.ok) omitted.push({ id: product.id, name: product.name, reason: isPublic ? "Ya estaba visible." : "Ya estaba oculto." });
    else if (result.error === PUBLISH_NEEDS_PRICE_MESSAGE) omitted.push({ id: product.id, name: product.name, reason: NEEDS_PRICE_TO_PUBLISH_REASON });
    else if (result.error.includes("archivado") || result.error.includes("ya no existe")) omitted.push({ id: product.id, name: product.name, reason: result.error });
    else errors.push({ id: product.id, name: product.name, reason: result.error });
  });
  await insertItemLogs(adminId, key, logs);
  return { result: done(changedIds.length, 0, omitted, errors), changedIds };
}

/** Archive (also hides it, like the single-row button) or restore. Batched updates guarded by the current state. */
async function runActive(ids: string[], active: boolean, adminId: string, key: string): Promise<BatchOutcome> {
  const products = await loadProducts(ids);
  const omitted: BulkItemIssue[] = [];
  const errors: BulkItemIssue[] = [];
  const candidates: LoadedProduct[] = [];
  for (const id of ids) {
    const product = products.get(id);
    if (!product) omitted.push({ id, name: "Producto", reason: MISSING_REASON });
    else if (product.is_active === active) omitted.push({ id, name: product.name, reason: active ? "No estaba archivado." : "Ya estaba archivado." });
    else candidates.push(product);
  }

  const changedIds: string[] = [];
  for (const batch of chunkList(candidates, STOCK_BATCH_SIZE)) {
    const { data, error } = await adminDb()
      .from("products")
      .update({ is_active: active, is_public: active ? undefined : false, updated_at: new Date().toISOString() })
      .in(
        "id",
        batch.map((product) => product.id),
      )
      .eq("is_active", !active)
      .select("id");
    if (error) {
      for (const product of batch) errors.push({ id: product.id, name: product.name, reason: describeError(new Error(error.message), "No se pudo guardar.") });
      continue;
    }
    const written = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
    for (const product of batch) {
      if (written.has(product.id)) changedIds.push(product.id);
      else omitted.push({ id: product.id, name: product.name, reason: "Cambió mientras se aplicaba; revísalo." });
    }
  }
  await insertItemLogs(
    adminId,
    key,
    changedIds.map((id) => ({
      action: active ? "PRODUCT_RESTORED" : "PRODUCT_ARCHIVED",
      entityType: "products",
      entityId: id,
      previousData: { is_active: !active, is_public: active ? false : products.get(id)?.is_public },
      newData: { is_active: active },
    })),
  );
  return { result: done(changedIds.length, 0, omitted, errors), changedIds };
}

/** Categoría / Marca: one column set to an existing, server-validated id. */
async function runColumn(
  ids: string[],
  column: "category_id" | "brand_id",
  value: string,
  adminId: string,
  key: string,
): Promise<BatchOutcome> {
  const products = await loadProducts(ids);
  const omitted: BulkItemIssue[] = [];
  const errors: BulkItemIssue[] = [];
  const candidates: LoadedProduct[] = [];
  for (const id of ids) {
    const product = products.get(id);
    if (!product) omitted.push({ id, name: "Producto", reason: MISSING_REASON });
    else if (product[column] === value) omitted.push({ id, name: product.name, reason: column === "category_id" ? "Ya estaba en esa categoría." : "Ya tenía esa marca." });
    else candidates.push(product);
  }

  const changedIds: string[] = [];
  for (const batch of chunkList(candidates, STOCK_BATCH_SIZE)) {
    const { data, error } = await adminDb()
      .from("products")
      .update({ [column]: value, updated_at: new Date().toISOString() })
      .in(
        "id",
        batch.map((product) => product.id),
      )
      .select("id");
    if (error) {
      for (const product of batch) errors.push({ id: product.id, name: product.name, reason: describeError(new Error(error.message), "No se pudo guardar.") });
      continue;
    }
    const written = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
    for (const product of batch) {
      if (written.has(product.id)) changedIds.push(product.id);
      else omitted.push({ id: product.id, name: product.name, reason: MISSING_REASON });
    }
  }
  await insertItemLogs(
    adminId,
    key,
    changedIds.map((id) => ({
      action: column === "category_id" ? "PRODUCT_CATEGORY_BULK_CHANGED" : "PRODUCT_BRAND_BULK_CHANGED",
      entityType: "products",
      entityId: id,
      previousData: { [column]: products.get(id)?.[column] ?? null },
      newData: { [column]: value },
    })),
  );
  return { result: done(changedIds.length, 0, omitted, errors), changedIds };
}

/** Existing brands for the "Cambiar marca" picker (only these can be chosen). */
export async function listBrandNames(): Promise<{ ok: true; names: string[] } | { ok: false; error: string }> {
  const names: string[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await adminDb().from("brands").select("name").order("name").range(from, from + 999);
    if (error) return { ok: false, error: describeError(new Error(error.message), "No fue posible leer las marcas.") };
    names.push(...((data ?? []) as Array<{ name: string }>).map((row) => row.name));
    if ((data ?? []).length < 1000) break;
  }
  return { ok: true, names };
}
