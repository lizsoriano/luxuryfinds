import { adminDb, PRODUCT_IMAGE_BUCKET } from "./business";
import { createAdminSupabaseClient } from "./admin";

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
  const map = new Map<string, boolean>();
  if (!productIds.length) return map;
  const { data, error } = await adminDb().from("products").select("id, weekly_plan_eligible").in("id", productIds);
  if (error) return map;
  for (const row of data ?? []) map.set(row.id as string, Boolean(row.weekly_plan_eligible));
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
  variants: VariantRow[];
  stock: number;
  minQuantity: number;
  priceCents: number;
  costCents: number;
};

const PAGE_SIZE = 20;

export type ProductSort = "recent" | "oldest" | "name_asc" | "name_desc";

export type ProductQuery = {
  search?: string;
  categoryId?: string;
  stockFilter?: "all" | "out" | "low";
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
  sort?: ProductSort;
};

function relationName(value: unknown): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return (row as { name?: string } | undefined)?.name ?? null;
}

export async function listProducts(query: ProductQuery = {}) {
  const { search, categoryId, stockFilter = "all", includeArchived = false, sort = "recent" } = query;
  const pageSize = query.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, query.page ?? 1);
  const db = adminDb();

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

  const from = (page - 1) * pageSize;
  builder =
    sort === "oldest"
      ? builder.order("created_at", { ascending: true })
      : sort === "name_asc"
        ? builder.order("name", { ascending: true })
        : sort === "name_desc"
          ? builder.order("name", { ascending: false })
          : builder.order("created_at", { ascending: false });
  const { data, error, count } = await builder.range(from, from + pageSize - 1);
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
      variants,
      stock: totalStock,
      minQuantity: variants.reduce((sum, variant) => sum + Number(variant.min_quantity ?? 0), 0),
      priceCents: cheapest?.price_cents ?? 0,
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
  };
}

const EXPORT_CAP = 5000;

/** Same filters as listProducts but unpaginated (capped), for the CSV export button. */
export async function listProductsForExport(query: Omit<ProductQuery, "page" | "pageSize"> = {}) {
  const { search, categoryId, includeArchived = false } = query;
  const db = adminDb();
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

  const { data, error } = await builder.order("name").limit(EXPORT_CAP);
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
  const { data, error } = await adminDb()
    .from("products")
    .select(
      `id, name, product_kind, is_active,
       categories(name),
       product_variants(id, name, sku, barcode, unit_label, price_cents, cost_cents, is_active),
       product_images(storage_key, sort_order)`,
    )
    .eq("is_active", true)
    .order("name")
    .limit(limit);
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

  const row = data as unknown as Omit<ProductDetail, "variants" | "images" | "weekly_plan_eligible"> & {
    product_variants: VariantRow[];
    product_images: Array<{ id: string; storage_key: string; sort_order: number }>;
  };
  const [stock, weeklyPlan] = await Promise.all([
    getStockFor((row.product_variants ?? []).map((variant) => variant.id)),
    getWeeklyPlanEligibility([id]),
  ]);

  return {
    ...row,
    weekly_plan_eligible: weeklyPlan.get(id) ?? false,
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
