import { describeError } from "../actions";
import { adminDb, PRODUCT_IMAGE_BUCKET } from "./business";
import { createAdminSupabaseClient } from "./admin";
import { IN_TRANSIT_UNAVAILABLE_MESSAGE, isMissingInTransitColumn, withInTransitFallback } from "./in-transit";

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  productCount: number;
};

/**
 * `products.weekly_plan_eligible` only exists once
 * database/migrations/004_weekly_plan_checkout.sql has been applied. It is
 * deliberately fetched in its own query rather than embedded in the main
 * products select used by listProducts/getProductDetail, so those (already
 * working) reads never break just because this migration hasn't run yet —
 * they simply treat every product as not-yet-eligible until it has.
 */
export async function getWeeklyPlanEligibility(productIds: string[]): Promise<Map<string, boolean>> {
  return getOptionalFlag("weekly_plan_eligible", productIds);
}

/**
 * `products.in_transit` (database/migrations/008_products_in_transit.sql) is
 * read the same way, for the same reason: until the migration runs, every
 * product simply reads as "not in transit".
 */
export async function getInTransitFlags(productIds: string[]): Promise<Map<string, boolean>> {
  return getOptionalFlag("in_transit", productIds);
}

async function getOptionalFlag(column: "weekly_plan_eligible" | "in_transit", productIds: string[]) {
  const map = new Map<string, boolean>();
  if (!productIds.length) return map;
  const { data, error } = await adminDb().from("products").select(`id, ${column}`).in("id", productIds);
  if (error) return map;
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    map.set(row.id as string, Boolean(row[column]));
  }
  return map;
}

export async function listCategoriesWithCounts(): Promise<CategoryRow[]> {
  const db = adminDb();
  const [categories, products] = await Promise.all([
    db.from("categories").select("id, name, slug, is_active, created_at").order("name"),
    db.from("products").select("category_id").eq("is_active", true),
  ]);
  if (categories.error) throw new Error(categories.error.message);
  if (products.error) throw new Error(products.error.message);

  const counts = new Map<string, number>();
  for (const row of products.data ?? []) {
    if (!row.category_id) continue;
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }
  return (categories.data ?? []).map((category) => ({
    ...category,
    productCount: counts.get(category.id) ?? 0,
  })) as CategoryRow[];
}

export async function listActiveCategories() {
  const { data, error } = await adminDb()
    .from("categories")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; name: string; slug: string }>;
}

export function productImageUrl(storageKey: string | null | undefined) {
  if (!storageKey) return null;
  return createAdminSupabaseClient().storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storageKey).data.publicUrl;
}

type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit_label: string | null;
  price_cents: number;
  cost_cents: number;
  min_quantity: number;
  is_active: boolean;
  attributes: Record<string, unknown>;
};

export type StockMap = Map<string, number>;

/**
 * `.in("variant_id", ids)` is sent as a query string, so a large catalogue
 * (thousands of variants at once, e.g. getInventoryKpis) can build a URL long
 * enough for Vercel/Supabase's edge to reject it with a bare 400 Bad Request.
 * Batching keeps every request's URL well under that limit.
 */
const STOCK_BATCH_SIZE = 150;

/** Available stock comes from the inventory_movements ledger through variant_stock. */
export async function getStockFor(variantIds: string[]): Promise<StockMap> {
  const map: StockMap = new Map();
  if (!variantIds.length) return map;

  for (let i = 0; i < variantIds.length; i += STOCK_BATCH_SIZE) {
    const batch = variantIds.slice(i, i + STOCK_BATCH_SIZE);
    const { data, error } = await adminDb()
      .from("variant_stock")
      .select("variant_id, available_quantity")
      .in("variant_id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      map.set(row.variant_id as string, Number(row.available_quantity ?? 0));
    }
  }
  return map;
}

export type ProductListVariant = VariantRow & { stock: number };

export type ProductListRow = {
  id: string;
  name: string;
  slug: string | null;
  internal_code: string | null;
  is_public: boolean;
  is_active: boolean;
  product_kind: "SIMPLE" | "VARIANTS" | "MEASURED";
  catalog_type: "ON_DEMAND" | "IMMEDIATE";
  categoryName: string | null;
  imageUrl: string | null;
  /** Active variants only, each with its own available stock (from the same single stock read as the totals). */
  variants: ProductListVariant[];
  stock: number;
  minQuantity: number;
  /** Cheapest active variant. */
  priceCents: number;
  /** Most expensive active variant (equals priceCents for a single-variant product). */
  maxPriceCents: number;
  costCents: number;
};

const PAGE_SIZE = 20;

export type ProductSort = "recent" | "oldest" | "name_asc" | "name_desc";

/**
 * The three Inventario lists the owner asked for:
 *  - online     catalogue sold by order (catalog_type ON_DEMAND, the synced stores)
 *  - inmediata  stock she has in hand (IMMEDIATE and not in transit)
 *  - en-camino  stock she already bought that is on its way (IMMEDIATE + in_transit)
 * No segment means every product (Inventario still uses it that way).
 */
export type ProductSegment = "online" | "inmediata" | "en-camino";

export const PRODUCT_SEGMENTS: readonly ProductSegment[] = ["online", "inmediata", "en-camino"];

export function isProductSegment(value: unknown): value is ProductSegment {
  return typeof value === "string" && (PRODUCT_SEGMENTS as readonly string[]).includes(value);
}

export type ProductQuery = {
  search?: string;
  categoryId?: string;
  stockFilter?: "all" | "out" | "low";
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
  sort?: ProductSort;
  segment?: ProductSegment;
};

/**
 * Applies the segment's catalog_type filter and, when `filterInTransit` is set,
 * its in_transit filter. Generic over the PostgREST builder so listProducts and
 * the CSV export share exactly the same rule.
 */
function applySegment<B extends { eq: (column: string, value: unknown) => B }>(
  builder: B,
  segment: ProductSegment | undefined,
  filterInTransit: boolean,
): B {
  if (segment === "online") return builder.eq("catalog_type", "ON_DEMAND");
  if (segment === "inmediata") {
    const immediate = builder.eq("catalog_type", "IMMEDIATE");
    return filterInTransit ? immediate.eq("in_transit", false) : immediate;
  }
  if (segment === "en-camino") return builder.eq("catalog_type", "IMMEDIATE").eq("in_transit", true);
  return builder;
}

/**
 * Runs a segment query. "inmediata" falls back to "every IMMEDIATE product" when
 * migration 008 is missing (nothing can be in transit yet, so that is exact);
 * "en-camino" cannot be answered at all without the column and reports
 * `unavailable` instead of failing.
 */
async function runSegmentQuery<R extends { error: { message: string } | null }>(
  segment: ProductSegment | undefined,
  run: (filterInTransit: boolean) => PromiseLike<R>,
): Promise<{ result: R; unavailable: boolean }> {
  if (segment === "inmediata") return { result: await withInTransitFallback(run), unavailable: false };
  const result = await run(segment === "en-camino");
  if (segment === "en-camino" && result.error && isMissingInTransitColumn(result.error.message)) {
    return { result, unavailable: true };
  }
  return { result, unavailable: false };
}

function relationName(value: unknown): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return (row as { name?: string } | undefined)?.name ?? null;
}

export async function listProducts(query: ProductQuery = {}) {
  const { search, categoryId, stockFilter = "all", includeArchived = false, sort = "recent", segment } = query;
  const pageSize = query.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, query.page ?? 1);
  const db = adminDb();
  const from = (page - 1) * pageSize;

  const run = (filterInTransit: boolean) => {
    let builder = db
      .from("products")
      .select(
        `id, name, slug, internal_code, is_public, is_active, product_kind, catalog_type, created_at,
         categories(name),
         product_variants(id, product_id, name, sku, barcode, unit_label, price_cents, cost_cents, min_quantity, is_active, attributes),
         product_images(storage_key, sort_order)`,
        { count: "exact" },
      );

    if (!includeArchived) builder = builder.eq("is_active", true);
    if (categoryId) builder = builder.eq("category_id", categoryId);
    if (search) builder = builder.or(`name.ilike.%${search}%,internal_code.ilike.%${search}%`);
    builder = applySegment(builder, segment, filterInTransit);

    builder =
      sort === "oldest"
        ? builder.order("created_at", { ascending: true })
        : sort === "name_asc"
          ? builder.order("name", { ascending: true })
          : sort === "name_desc"
            ? builder.order("name", { ascending: false })
            : builder.order("created_at", { ascending: false });
    return builder.range(from, from + pageSize - 1);
  };

  const { result, unavailable } = await runSegmentQuery(segment, run);
  if (unavailable) {
    return {
      products: [] as ProductListRow[],
      page,
      pageSize,
      total: 0,
      hasNextPage: false,
      filtered: false,
      unavailable: true,
    };
  }
  const { data, error, count } = result;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    slug: string | null;
    internal_code: string | null;
    is_public: boolean;
    is_active: boolean;
    product_kind: ProductListRow["product_kind"];
    catalog_type: ProductListRow["catalog_type"];
    categories: unknown;
    product_variants: VariantRow[];
    product_images: Array<{ storage_key: string; sort_order: number }>;
  }>;

  const variantIds = rows.flatMap((row) => (row.product_variants ?? []).map((variant) => variant.id));
  const stock = await getStockFor(variantIds);

  let products: ProductListRow[] = rows.map((row) => {
    const variants = (row.product_variants ?? []).filter((variant) => variant.is_active);
    const image = [...(row.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
    const totalStock = variants.reduce((sum, variant) => sum + (stock.get(variant.id) ?? 0), 0);
    const cheapest = variants.reduce<VariantRow | null>(
      (best, variant) => (!best || variant.price_cents < best.price_cents ? variant : best),
      null,
    );
    const priciest = variants.reduce((max, variant) => Math.max(max, Number(variant.price_cents ?? 0)), 0);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      internal_code: row.internal_code,
      is_public: row.is_public,
      is_active: row.is_active,
      product_kind: row.product_kind ?? "SIMPLE",
      catalog_type: row.catalog_type,
      categoryName: relationName(row.categories),
      imageUrl: productImageUrl(image?.storage_key),
      variants: variants.map((variant) => ({ ...variant, stock: stock.get(variant.id) ?? 0 })),
      stock: totalStock,
      minQuantity: variants.reduce((sum, variant) => sum + Number(variant.min_quantity ?? 0), 0),
      priceCents: cheapest?.price_cents ?? 0,
      maxPriceCents: priciest,
      costCents: cheapest?.cost_cents ?? 0,
    };
  });

  if (stockFilter === "out") products = products.filter((product) => product.stock <= 0);
  if (stockFilter === "low") {
    products = products.filter((product) => product.stock > 0 && product.minQuantity > 0 && product.stock <= product.minQuantity);
  }

  return {
    products,
    page,
    pageSize,
    total: count ?? products.length,
    hasNextPage: (count ?? 0) > from + pageSize,
    filtered: stockFilter !== "all",
    unavailable: false,
  };
}

const EXPORT_CAP = 5000;

/** Same filters as listProducts but unpaginated (capped), for the CSV export button. */
export async function listProductsForExport(query: Omit<ProductQuery, "page" | "pageSize"> = {}) {
  const { search, categoryId, includeArchived = false, segment } = query;
  const db = adminDb();
  const run = (filterInTransit: boolean) => {
    let builder = db
      .from("products")
      .select(
        `id, name, internal_code, is_public, is_active, product_kind, catalog_type,
         categories(name),
         product_variants(id, name, sku, barcode, price_cents, cost_cents, min_quantity, is_active)`,
      );
    if (!includeArchived) builder = builder.eq("is_active", true);
    if (categoryId) builder = builder.eq("category_id", categoryId);
    if (search) builder = builder.or(`name.ilike.%${search}%,internal_code.ilike.%${search}%`);
    builder = applySegment(builder, segment, filterInTransit);
    return builder.order("name").limit(EXPORT_CAP);
  };

  const { result, unavailable } = await runSegmentQuery(segment, run);
  if (unavailable) throw new Error(IN_TRANSIT_UNAVAILABLE_MESSAGE);
  const { data, error } = result;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    internal_code: string | null;
    is_public: boolean;
    is_active: boolean;
    product_kind: ProductListRow["product_kind"];
    catalog_type: ProductListRow["catalog_type"];
    categories: unknown;
    product_variants: VariantRow[];
  }>;

  const variantIds = rows.flatMap((row) => (row.product_variants ?? []).map((v) => v.id));
  const stock = await getStockFor(variantIds);

  return rows.flatMap((row) => {
    const variants = (row.product_variants ?? []).filter((v) => v.is_active);
    const categoryName = relationName(row.categories);
    if (!variants.length) {
      return [
        {
          producto: row.name,
          codigo: row.internal_code ?? "",
          categoria: categoryName ?? "",
          tipo: row.product_kind,
          variante: "",
          sku: "",
          stock: 0,
          precio: 0,
          costo: 0,
          estado: !row.is_active ? "Archivado" : row.is_public ? "Visible" : "Oculto",
        },
      ];
    }
    return variants.map((variant) => ({
      producto: row.name,
      codigo: row.internal_code ?? variant.sku ?? "",
      categoria: categoryName ?? "",
      tipo: row.product_kind,
      variante: variant.name,
      sku: variant.sku ?? "",
      stock: stock.get(variant.id) ?? 0,
      precio: (variant.price_cents ?? 0) / 100,
      costo: (variant.cost_cents ?? 0) / 100,
      estado: !row.is_active ? "Archivado" : row.is_public ? "Visible" : "Oculto",
    }));
  });
}

/**
 * Inventory KPIs need every active variant, not just the current page. The
 * catalogue is a boutique-sized dataset; the cap keeps the query bounded and the
 * UI says so when it is reached.
 */
const KPI_VARIANT_CAP = 2000;

export async function getInventoryKpis() {
  const db = adminDb();
  const { data, error } = await db
    .from("product_variants")
    .select("id, cost_cents, price_cents, min_quantity, product_id, products!inner(is_active)")
    .eq("is_active", true)
    .eq("products.is_active", true)
    .limit(KPI_VARIANT_CAP);
  if (error) throw new Error(error.message);

  const variants = (data ?? []) as unknown as Array<{
    id: string;
    cost_cents: number;
    price_cents: number;
    min_quantity: number;
    product_id: string;
  }>;
  const stock = await getStockFor(variants.map((variant) => variant.id));

  let costTotalCents = 0;
  let retailTotalCents = 0;
  let outOfStock = 0;
  let lowStock = 0;
  const products = new Set<string>();

  for (const variant of variants) {
    const available = stock.get(variant.id) ?? 0;
    products.add(variant.product_id);
    costTotalCents += Math.round(available * Number(variant.cost_cents ?? 0));
    retailTotalCents += Math.round(available * Number(variant.price_cents ?? 0));
    if (available <= 0) outOfStock += 1;
    else if (Number(variant.min_quantity ?? 0) > 0 && available <= Number(variant.min_quantity)) lowStock += 1;
  }

  return {
    referenceCount: variants.length,
    productCount: products.size,
    costTotalCents,
    retailTotalCents,
    outOfStock,
    lowStock,
    capped: variants.length >= KPI_VARIANT_CAP,
  };
}

export type SellableVariant = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  barcode: string | null;
  unitLabel: string | null;
  priceCents: number;
  costCents: number;
  stock: number;
  allowsDecimal: boolean;
  categoryName: string | null;
  imageUrl: string | null;
};

const SELLABLE_CAP = 300;

/**
 * The POS loads its catalogue once and filters in memory: a counter sale must
 * not lose the basket to a page reload on every keystroke.
 */
export async function listSellableVariants(limit = SELLABLE_CAP): Promise<SellableVariant[]> {
  // Merchandise still on its way (products.in_transit) is not sellable yet,
  // even when a quantity was already captured for it. Without migration 008
  // the column does not exist and nothing can be in transit, so the same query
  // simply runs without that filter.
  const { data, error } = await withInTransitFallback((filterInTransit) => {
    let builder = adminDb()
      .from("products")
      .select(
        `id, name, product_kind, is_active,
         categories(name),
         product_variants(id, name, sku, barcode, unit_label, price_cents, cost_cents, is_active),
         product_images(storage_key, sort_order)`,
      )
      .eq("is_active", true);
    if (filterInTransit) builder = builder.eq("in_transit", false);
    return builder.order("name").limit(limit);
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    product_kind: ProductListRow["product_kind"];
    categories: unknown;
    product_variants: Array<{
      id: string;
      name: string;
      sku: string | null;
      barcode: string | null;
      unit_label: string | null;
      price_cents: number;
      cost_cents: number;
      is_active: boolean;
    }>;
    product_images: Array<{ storage_key: string; sort_order: number }>;
  }>;

  const flattened = rows.flatMap((row) => {
    const image = [...(row.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
    const categoryName = relationName(row.categories);
    return (row.product_variants ?? [])
      .filter((variant) => variant.is_active)
      .map((variant) => ({
        variantId: variant.id,
        productId: row.id,
        productName: row.name,
        variantName: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        unitLabel: variant.unit_label,
        priceCents: variant.price_cents,
        costCents: variant.cost_cents ?? 0,
        stock: 0,
        allowsDecimal: (row.product_kind ?? "SIMPLE") === "MEASURED",
        categoryName,
        imageUrl: productImageUrl(image?.storage_key),
      }));
  });

  const stock = await getStockFor(flattened.map((item) => item.variantId));
  return flattened.map((item) => ({ ...item, stock: stock.get(item.variantId) ?? 0 }));
}

export type ProductDetail = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  internal_code: string | null;
  is_public: boolean;
  is_active: boolean;
  product_kind: ProductListRow["product_kind"];
  catalog_type: ProductListRow["catalog_type"];
  category_id: string | null;
  tax_rate_percent: number;
  weekly_plan_eligible: boolean;
  in_transit: boolean;
  variants: Array<VariantRow & { stock: number }>;
  images: Array<{ id: string; storage_key: string; url: string | null; sort_order: number }>;
};

export async function getProductDetail(id: string): Promise<ProductDetail | null> {
  const { data, error } = await adminDb()
    .from("products")
    .select(
      `id, name, slug, description, internal_code, is_public, is_active, product_kind, catalog_type, category_id, tax_rate_percent,
       product_variants(id, product_id, name, sku, barcode, unit_label, price_cents, cost_cents, min_quantity, is_active, attributes),
       product_images(id, storage_key, sort_order)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as Omit<ProductDetail, "variants" | "images" | "weekly_plan_eligible" | "in_transit"> & {
    product_variants: VariantRow[];
    product_images: Array<{ id: string; storage_key: string; sort_order: number }>;
  };
  const [stock, weeklyPlan, inTransit] = await Promise.all([
    getStockFor((row.product_variants ?? []).map((variant) => variant.id)),
    getWeeklyPlanEligibility([id]),
    getInTransitFlags([id]),
  ]);

  return {
    ...row,
    weekly_plan_eligible: weeklyPlan.get(id) ?? false,
    in_transit: row.catalog_type === "IMMEDIATE" && (inTransit.get(id) ?? false),
    tax_rate_percent: Number(row.tax_rate_percent ?? 0),
    variants: (row.product_variants ?? []).map((variant) => ({
      ...variant,
      min_quantity: Number(variant.min_quantity ?? 0),
      stock: stock.get(variant.id) ?? 0,
    })),
    images: [...(row.product_images ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((image) => ({ ...image, url: productImageUrl(image.storage_key) })),
  };
}

/** Slugs are UNIQUE (citext) on both categories and products. */
export async function ensureUniqueSlug(table: "categories" | "products", base: string, excludeId?: string) {
  const db = adminDb();
  const root = base || "item";
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    let builder = db.from(table).select("id").eq("slug", candidate).limit(1);
    if (excludeId) builder = builder.neq("id", excludeId);
    const { data, error } = await builder;
    if (error) throw new Error(error.message);
    if (!data?.length) return candidate;
  }
  return `${root}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Inventory movements
// ---------------------------------------------------------------------------

/**
 * The only two movement types schema.sql allows outside of a sale/pedido/
 * delivery: RECEIPT (new stock coming in, always positive) and
 * MANUAL_ADJUSTMENT (a correction, either direction, e.g. shrinkage/breakage
 * found on a physical count). Both write straight into inventory_movements —
 * the same ledger Vender and Pedidos already use — so variant_stock and every
 * KPI derived from it stay correct with no separate stock field to keep in sync.
 */
export const MANUAL_MOVEMENT_TYPES = ["RECEIPT", "MANUAL_ADJUSTMENT"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export type MovementResult = { ok: true } | { ok: false; error: string };

/**
 * Shared by the Inventario movement dialog and the quick stock edit in the
 * Productos lists. Refuses to leave stock negative and respects the table's
 * CHECK (RECEIPT > 0, MANUAL_ADJUSTMENT <> 0). `currentStock` may be passed when
 * the caller has just read it, to skip a second read.
 */
export async function recordManualMovement(input: {
  variantId: string;
  movementType: ManualMovementType;
  quantityDelta: number;
  reason: string;
  adminId: string | null;
  currentStock?: number;
}): Promise<MovementResult> {
  const { variantId, movementType, quantityDelta, reason, adminId } = input;
  if (!MANUAL_MOVEMENT_TYPES.includes(movementType)) return { ok: false, error: "Tipo de movimiento no válido." };
  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    return { ok: false, error: "Escribe una cantidad distinta de cero." };
  }
  if (movementType === "RECEIPT" && quantityDelta < 0) {
    return { ok: false, error: "Una entrada debe ser una cantidad positiva." };
  }

  if (quantityDelta < 0) {
    const available = input.currentStock ?? (await getStockFor([variantId])).get(variantId) ?? 0;
    if (available + quantityDelta < 0) {
      return {
        ok: false,
        error: `El ajuste dejaría el stock en negativo: disponible ${available}, ajuste ${quantityDelta}.`,
      };
    }
  }

  const { error } = await adminDb().from("inventory_movements").insert({
    variant_id: variantId,
    movement_type: movementType,
    quantity_delta: quantityDelta,
    reason,
    created_by_admin_id: adminId,
  });
  if (error) return { ok: false, error: describeError(new Error(error.message), "No fue posible registrar el movimiento.") };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Quick edit from the Productos lists
// ---------------------------------------------------------------------------

export const QUICK_STOCK_REASON = "Ajuste rápido desde la lista de productos";

export type QuickEditField = "price" | "stock";

export type QuickEditResult =
  | {
      ok: true;
      changed: boolean;
      field: QuickEditField;
      productId: string;
      productName: string;
      variantId: string;
      /** Cents for price, units for stock. */
      previous: number;
      next: number;
      /** Only for stock: the movement actually written (0 when nothing changed). */
      delta: number;
    }
  | { ok: false; error: string };

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Business logic behind the inline Stock / Precio inputs. Kept out of the
 * server action (which only checks the session) so it can be exercised with
 * the service key and an explicit admin id.
 *
 *  price  -> `value` is the new price in cents; updates product_variants.price_cents.
 *  stock  -> `value` is the quantity the admin says is on hand. Stock is never
 *            written as a number: the difference against variant_stock, read
 *            here at save time (not whatever the page showed), is appended to
 *            the ledger as a MANUAL_ADJUSTMENT. No difference, no movement.
 */
export async function updateVariantQuick(input: {
  variantId: string;
  field: QuickEditField;
  value: number;
  adminId: string | null;
}): Promise<QuickEditResult> {
  const { variantId, field, value, adminId } = input;
  if (!variantId) return { ok: false, error: "Variante no encontrada." };
  if (field !== "price" && field !== "stock") return { ok: false, error: "Campo no válido." };
  if (!Number.isFinite(value)) {
    return { ok: false, error: field === "price" ? "Escribe un precio válido." : "Escribe una cantidad válida." };
  }
  if (value < 0) {
    return { ok: false, error: field === "price" ? "El precio no puede ser negativo." : "La cantidad no puede ser negativa." };
  }

  const db = adminDb();
  const { data, error } = await db
    .from("product_variants")
    .select("id, product_id, price_cents, is_active, products(name, product_kind, is_active)")
    .eq("id", variantId)
    .maybeSingle();
  if (error) return { ok: false, error: describeError(new Error(error.message), "No fue posible leer la variante.") };
  if (!data) return { ok: false, error: "Variante no encontrada." };

  const product = (Array.isArray(data.products) ? data.products[0] : data.products) as
    | { name: string; product_kind: ProductListRow["product_kind"] | null; is_active: boolean }
    | null;
  if (!product) return { ok: false, error: "Producto no encontrado." };
  if (!product.is_active) return { ok: false, error: "El producto está archivado. Restáuralo para editarlo." };
  if (!data.is_active) return { ok: false, error: "Esta variante está desactivada." };

  const base = {
    ok: true as const,
    field,
    productId: data.product_id as string,
    productName: product.name,
    variantId,
  };

  if (field === "price") {
    if (!Number.isInteger(value)) return { ok: false, error: "El precio debe ir en centavos enteros." };
    const previous = Number(data.price_cents ?? 0);
    if (previous === value) return { ...base, changed: false, previous, next: value, delta: 0 };
    const { error: updateError } = await db
      .from("product_variants")
      .update({ price_cents: value, updated_at: new Date().toISOString() })
      .eq("id", variantId);
    if (updateError) {
      return { ok: false, error: describeError(new Error(updateError.message), "No fue posible guardar el precio.") };
    }
    return { ...base, changed: true, previous, next: value, delta: 0 };
  }

  const measured = (product.product_kind ?? "SIMPLE") === "MEASURED";
  const target = round3(value);
  if (!measured && !Number.isInteger(target)) {
    return { ok: false, error: "Este producto solo admite cantidades enteras." };
  }

  const current = (await getStockFor([variantId])).get(variantId) ?? 0;
  const delta = round3(target - current);
  if (delta === 0) return { ...base, changed: false, previous: current, next: target, delta: 0 };

  const movement = await recordManualMovement({
    variantId,
    movementType: "MANUAL_ADJUSTMENT",
    quantityDelta: delta,
    reason: QUICK_STOCK_REASON,
    adminId,
    currentStock: current,
  });
  if (!movement.ok) return movement;
  return { ...base, changed: true, previous: current, next: target, delta };
}

/**
 * "Marcar como recibido": the merchandise arrived, so it leaves "en camino" and
 * becomes regular Entrega inmediata stock (in_transit = false). Only IMMEDIATE
 * products can be in transit at all.
 */
export async function markProductReceived(productId: string): Promise<
  { ok: true; name: string } | { ok: false; error: string }
> {
  if (!productId) return { ok: false, error: "Producto no encontrado." };
  const { data, error } = await adminDb()
    .from("products")
    .update({ in_transit: false, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("catalog_type", "IMMEDIATE")
    .select("id, name");
  if (error) {
    if (isMissingInTransitColumn(error.message)) return { ok: false, error: IN_TRANSIT_UNAVAILABLE_MESSAGE };
    return { ok: false, error: describeError(new Error(error.message), "No fue posible marcar el producto como recibido.") };
  }
  const row = data?.[0];
  if (!row) return { ok: false, error: "El producto ya no existe o no es de entrega inmediata." };
  return { ok: true, name: row.name as string };
}
