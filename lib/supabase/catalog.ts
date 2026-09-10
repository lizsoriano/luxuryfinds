import { createAdminSupabaseClient } from "./admin";

export type CatalogType = "ON_DEMAND" | "IMMEDIATE";
export type CatalogSort = "recommended" | "price_asc" | "price_desc" | "name_asc" | "name_desc" | "recent";

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

  let query = db
    .from("products")
    .select(`
      id,
      slug,
      name,
      catalog_type,
      categories(name),
      brands(name),
      product_variants(id, name, price_cents, is_active),
      product_images(storage_key, sort_order)
    `)
    .eq("is_public", true)
    .eq("is_active", true)
    .eq("product_variants.is_active", true);

  if (catalogType) query = query.eq("catalog_type", catalogType);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (brandId) query = query.eq("brand_id", brandId);
  if (search) {
    const term = `%${search}%`;
    const parts = [`name.ilike.${term}`];
    if (searchBrandIds.length) parts.push(`brand_id.in.(${searchBrandIds.join(",")})`);
    query = query.or(parts.join(","));
  }

  if (sort === "name_asc") query = query.order("name", { ascending: true });
  else if (sort === "name_desc") query = query.order("name", { ascending: false });
  else query = query.order("created_at", { ascending: false });

  const from = (page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data, error } = await query;
  if (error) throw new Error(`No fue posible cargar el catálogo: ${error.message}`);

  let products = ((data ?? []) as unknown as ProductRow[]).flatMap((row, index) => {
    const variant = row.product_variants?.[0];
    if (!variant) return [];

    const category = firstRelation(row.categories)?.name ?? "Selección";
    const productBrand = firstRelation(row.brands)?.name ?? "Luxury Finds";
    const image = [...(row.product_images ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    )[0];
    const imageUrl = image
      ? supabase.storage.from("oskinmx-catalog").getPublicUrl(image.storage_key).data
          .publicUrl
      : null;
    const tones = ["rose", "cream", "wine", "beige"] as const;

    return [{
      id: row.slug ?? row.id,
      slug: row.slug,
      name: row.name,
      category: `${category} · ${productBrand}`,
      brand: productBrand,
      variant: variant.name,
      priceCents: variant.price_cents,
      availability:
        row.catalog_type === "IMMEDIATE" ? "Entrega inmediata" : "Por pedido",
      imageUrl,
      tone: tones[index % tones.length],
    } satisfies CatalogProduct];
  });

  if (typeof minPrice === "number") products = products.filter((p) => p.priceCents >= minPrice * 100);
  if (typeof maxPrice === "number") products = products.filter((p) => p.priceCents <= maxPrice * 100);

  if (sort === "price_asc") products = [...products].sort((a, b) => a.priceCents - b.priceCents);
  else if (sort === "price_desc") products = [...products].sort((a, b) => b.priceCents - a.priceCents);

  return { products, page, pageSize: PAGE_SIZE, hasNextPage: (data?.length ?? 0) === PAGE_SIZE };
}
