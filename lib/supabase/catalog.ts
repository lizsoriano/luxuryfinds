import { createServerSupabaseClient } from "./server";

export type CatalogType = "ON_DEMAND" | "IMMEDIATE";

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

export async function getCatalogProducts(catalogType?: CatalogType) {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .schema("luxury_finds")
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
    .eq("product_variants.is_active", true)
    .order("created_at", { ascending: false });

  if (catalogType) query = query.eq("catalog_type", catalogType);

  const { data, error } = await query;
  if (error) throw new Error(`No fue posible cargar el catálogo: ${error.message}`);

  return ((data ?? []) as unknown as ProductRow[]).flatMap((row, index) => {
    const variant = row.product_variants?.[0];
    if (!variant) return [];

    const category = firstRelation(row.categories)?.name ?? "Selección";
    const brand = firstRelation(row.brands)?.name ?? "Luxury Finds";
    const image = [...(row.product_images ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    )[0];
    const imageUrl = image
      ? supabase.storage.from("product-images").getPublicUrl(image.storage_key).data
          .publicUrl
      : null;
    const tones = ["rose", "cream", "wine", "beige"] as const;

    return [{
      id: row.slug ?? row.id,
      slug: row.slug,
      name: row.name,
      category: `${category} · ${brand}`,
      brand,
      variant: variant.name,
      priceCents: variant.price_cents,
      availability:
        row.catalog_type === "IMMEDIATE" ? "Entrega inmediata" : "Por pedido",
      imageUrl,
      tone: tones[index % tones.length],
    } satisfies CatalogProduct];
  });
}
