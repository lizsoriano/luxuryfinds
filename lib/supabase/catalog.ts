import { createAdminSupabaseClient } from "./admin";

export type CatalogType = "ON_DEMAND" | "IMMEDIATE";
export type CatalogSort =
  | "recommended"
  | "price_asc"
  | "price_desc"
  | "name_asc"
  | "name_desc"
  | "recent"
  | "bestsellers";

export type CatalogProduct = {
  id: string;
  slug: string | null;
  name: string;
  category: string;
  brand: string;
  variant: string;
  priceCents: number;
  availability: "Entrega inmediata" | "Por pedido";
  imageUrl: string | null;
  tone: "rose" | "cream" | "wine" | "beige";
};

export type CatalogFilters = {
  catalogType?: CatalogType;
  categorySlug?: string;
  brand?: string;
  search?: string;
  sort?: CatalogSort;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
};

type Relation<T> = T | T[] | null;

type ProductRow = {
  id: string;
  slug: string | null;
  name: string;
  catalog_type: CatalogType;
  categories: Relation<{ name: string }>;
  brands: Relation<{ name: string }>;
  product_variants: Array<{
    id: string;
    name: string;
    price_cents: number;
    is_active: boolean;
  }>;
  product_images: Array<{
    storage_key: string;
    sort_order: number;
  }>;
};

function firstRelation<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const TONES = ["rose", "cream", "wine", "beige"] as const;

function mapProductRow(
  row: ProductRow,
  toneIndex: number,
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): CatalogProduct | null {
  const variant = row.product_variants?.[0];
  if (!variant) return null;

  const category = firstRelation(row.categories)?.name ?? "Selección";
  const productBrand = firstRelation(row.brands)?.name ?? "Luxury Finds";
  const image = [...(row.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
  const imageUrl = image
    ? supabase.storage.from("oskinmx-catalog").getPublicUrl(image.storage_key).data.publicUrl
    : null;

  return {
    id: row.slug ?? row.id,
    slug: row.slug,
    name: row.name,
    category: `${category} · ${productBrand}`,
    brand: productBrand,
    variant: variant.name,
    priceCents: variant.price_cents,
    availability: row.catalog_type === "IMMEDIATE" ? "Entrega inmediata" : "Por pedido",
    imageUrl,
    tone: TONES[toneIndex % TONES.length],
  };
}

const PRODUCT_SELECT = `
  id,
  slug,
  name,
  catalog_type,
  categories(name),
  brands(name),
  product_variants(id, name, price_cents, is_active),
  product_images(storage_key, sort_order)
`;

/** Real product ids, ranked by total units sold (order_items + direct POS sale_items). */
async function rankByBestsellers(limit = 200): Promise<string[]> {
  const supabase = createAdminSupabaseClient();
  const db = supabase.schema("luxury_finds");
  const totals = new Map<string, number>();

  const [orderItems, saleItems] = await Promise.all([
    db.from("order_items").select("product_id, quantity").not("product_id", "is", null).limit(5000),
    db.from("sale_items").select("product_id, quantity").not("product_id", "is", null).limit(5000),
  ]);
  for (const row of orderItems.data ?? []) {
    if (!row.product_id) continue;
    totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + Number(row.quantity ?? 0));
  }
  for (const row of saleItems.data ?? []) {
    if (!row.product_id) continue;
    totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + Number(row.quantity ?? 0));
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

const PAGE_SIZE = 24;

export async function getCatalogCategories() {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .schema("luxury_finds")
    .from("categories")
    .select("id,name,slug")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data;
}

export async function getCatalogBrands(limit = 12) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .schema("luxury_finds")
    .from("brands")
    .select("id,name")
    .order("name")
    .limit(limit);
  if (error) throw error;
  return data;
}

export type CatalogProductDetail = {
  slug: string;
  name: string;
  description: string | null;
  relevantInformation: string | null;
  category: string;
  brand: string;
  catalogType: CatalogType;
  availability: "Entrega inmediata" | "Por pedido";
  images: string[];
  variants: Array<{ id: string; name: string; priceCents: number }>;
};

export async function getCatalogProductBySlug(slug: string): Promise<CatalogProductDetail | null> {
  const supabase = createAdminSupabaseClient();
  const db = supabase.schema("luxury_finds");

  const { data, error } = await db
    .from("products")
    .select(`
      slug,
      name,
      description,
      relevant_information,
      catalog_type,
      categories(name),
      brands(name),
      product_variants(id, name, price_cents, is_active),
      product_images(storage_key, sort_order)
    `)
    .eq("slug", slug)
    .eq("is_public", true)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`No fue posible cargar el producto: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as ProductRow & { description: string | null; relevant_information: string | null };
  const images = [...(row.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => supabase.storage.from("oskinmx-catalog").getPublicUrl(img.storage_key).data.publicUrl);

  return {
    slug: row.slug ?? slug,
    name: row.name,
    description: row.description,
    relevantInformation: row.relevant_information,
    category: firstRelation(row.categories)?.name ?? "Selección",
    brand: firstRelation(row.brands)?.name ?? "Luxury Finds",
    catalogType: row.catalog_type,
    availability: row.catalog_type === "IMMEDIATE" ? "Entrega inmediata" : "Por pedido",
    images,
    variants: (row.product_variants ?? [])
      .filter((v) => v.is_active)
      .map((v) => ({ id: v.id, name: v.name, priceCents: v.price_cents })),
  };
}

export async function getCatalogProducts(filters: CatalogFilters = {}) {
  const { catalogType, categorySlug, brand, search, sort = "recommended", minPrice, maxPrice, page = 1 } = filters;
  const supabase = createAdminSupabaseClient();
  const db = supabase.schema("luxury_finds");

  let categoryId: string | undefined;
  if (categorySlug) {
    const { data } = await db.from("categories").select("id").eq("slug", categorySlug).maybeSingle();
    categoryId = data?.id ?? undefined;
  }

  let brandId: string | undefined;
  if (brand) {
    const { data } = await db.from("brands").select("id").eq("name", brand).maybeSingle();
    brandId = data?.id ?? undefined;
  }

  let searchBrandIds: string[] = [];
  if (search) {
    const { data } = await db.from("brands").select("id").ilike("name", `%${search}%`);
    searchBrandIds = (data ?? []).map((b) => b.id);
  }

  let bestsellerRank: string[] | null = null;
  if (sort === "bestsellers") bestsellerRank = await rankByBestsellers();

  let query = db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_public", true)
    .eq("is_active", true)
    .eq("product_variants.is_active", true);

  if (catalogType) query = query.eq("catalog_type", catalogType);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (brandId) query = query.eq("brand_id", brandId);
  if (bestsellerRank) query = query.in("id", bestsellerRank.length ? bestsellerRank : ["00000000-0000-0000-0000-000000000000"]);
  if (search) {
    const term = `%${search}%`;
    const parts = [`name.ilike.${term}`];
    if (searchBrandIds.length) parts.push(`brand_id.in.(${searchBrandIds.join(",")})`);
    query = query.or(parts.join(","));
  }

  if (sort === "name_asc") query = query.order("name", { ascending: true });
  else if (sort === "name_desc") query = query.order("name", { ascending: false });
  else if (!bestsellerRank) query = query.order("created_at", { ascending: false });

  // Bestsellers rank comes from a separate aggregate, not a column Postgres can
  // ORDER BY - fetch every match (bounded by the rank's own cap) and sort/page
  // in memory instead of relying on .range() for this one sort.
  if (!bestsellerRank) {
    const from = (page - 1) * PAGE_SIZE;
    query = query.range(from, from + PAGE_SIZE - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error(`No fue posible cargar el catálogo: ${error.message}`);

  let products = ((data ?? []) as unknown as ProductRow[]).flatMap((row, index) => {
    const mapped = mapProductRow(row, index, supabase);
    return mapped ? [mapped] : [];
  });

  let bestsellerTotal: number | null = null;
  if (bestsellerRank) {
    const rankIndex = new Map(bestsellerRank.map((id, i) => [id, i]));
    const byDbId = new Map(((data ?? []) as unknown as ProductRow[]).map((row) => [row.slug ?? row.id, row.id]));
    products = [...products].sort((a, b) => {
      const ra = rankIndex.get(byDbId.get(a.id) ?? "") ?? Number.MAX_SAFE_INTEGER;
      const rb = rankIndex.get(byDbId.get(b.id) ?? "") ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
    bestsellerTotal = products.length;
    const from = (page - 1) * PAGE_SIZE;
    products = products.slice(from, from + PAGE_SIZE);
  }

  if (typeof minPrice === "number") products = products.filter((p) => p.priceCents >= minPrice * 100);
  if (typeof maxPrice === "number") products = products.filter((p) => p.priceCents <= maxPrice * 100);

  if (sort === "price_asc") products = [...products].sort((a, b) => a.priceCents - b.priceCents);
  else if (sort === "price_desc") products = [...products].sort((a, b) => b.priceCents - a.priceCents);

  const hasNextPage =
    bestsellerTotal !== null ? page * PAGE_SIZE < bestsellerTotal : (data?.length ?? 0) === PAGE_SIZE;
  return { products, page, pageSize: PAGE_SIZE, hasNextPage };
}

/** Products a client has favorited, most recently favorited first. Reuses the same public-catalog shape. */
/**
 * `identities` are the same slug-or-id values ProductCard/CartContext/favorites
 * use everywhere else (see identityOf in app/api/favorites/route.ts) - NOT
 * necessarily products.id. A product with a slug is identified by its slug,
 * so filtering on the id column alone would silently match nothing for it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getProductsByIds(identities: string[]): Promise<CatalogProduct[]> {
  if (!identities.length) return [];
  const supabase = createAdminSupabaseClient();
  const db = supabase.schema("luxury_finds");

  // Split by shape rather than one .or() filter: PostgREST tries to cast every
  // value in an `id.in.(...)` clause to uuid, and a plain slug isn't one - that
  // throws (22P02) instead of just not matching, so slugs and ids need separate
  // .in() queries, not a shared OR.
  const uuids = identities.filter((value) => UUID_RE.test(value));
  const slugs = identities.filter((value) => !UUID_RE.test(value));

  const baseQuery = () =>
    db
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("is_public", true)
      .eq("is_active", true)
      .eq("product_variants.is_active", true);

  const [bySlug, byUuid] = await Promise.all([
    slugs.length ? baseQuery().in("slug", slugs) : Promise.resolve({ data: [], error: null }),
    uuids.length ? baseQuery().in("id", uuids) : Promise.resolve({ data: [], error: null }),
  ]);
  if (bySlug.error) throw new Error(`No fue posible cargar tus favoritos: ${bySlug.error.message}`);
  if (byUuid.error) throw new Error(`No fue posible cargar tus favoritos: ${byUuid.error.message}`);

  const rows = [...(bySlug.data ?? []), ...(byUuid.data ?? [])] as unknown as ProductRow[];
  const byIdentity = new Map<string, ProductRow>();
  for (const row of rows) {
    byIdentity.set(row.id, row);
    if (row.slug) byIdentity.set(row.slug, row);
  }
  // identities arrives ordered (most recently favorited first) - preserve that
  // order rather than whatever order Postgres happened to return rows in.
  return identities.flatMap((identity, index) => {
    const row = byIdentity.get(identity);
    if (!row) return [];
    const mapped = mapProductRow(row, index, supabase);
    return mapped ? [mapped] : [];
  });
}
