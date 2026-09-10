import { createAdminSupabaseClient } from "./admin";
import type { CartItem } from "../cart/CartContext";

export type ResolvedOrderItem = {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceCents: number;
  name: string;
};

export type ResolveOrderItemsResult = {
  resolved: ResolvedOrderItem[];
  /** Cart lines that could not be matched to a live, public, active product/variant. */
  skipped: Array<{ slug: string; name: string }>;
};

type ProductRow = {
  id: string;
  slug: string | null;
  name: string;
  is_public: boolean;
  is_active: boolean;
  product_variants: Array<{ id: string; price_cents: number; is_active: boolean }>;
};

/**
 * Re-fetches the real product/variant rows from the database for every line in a
 * client-supplied cart and returns the *server-trusted* ids and prices to use when
 * creating order_items. We never trust productId/variantId/priceCents as sent from
 * the browser (they come from localStorage, which the client fully controls) —
 * only the slug is used to look the product back up.
 *
 * Note: cart lines added from the catalog listing (ProductCard) don't carry a
 * specific variantId — they resolve to the product's first active variant, which
 * mirrors how the listing itself picks the "displayed" price
 * (see lib/supabase/catalog.ts getCatalogProducts). This isn't a perfect
 * re-selection of "the variant the shopper saw" when a product has several
 * variants at different prices; a future improvement would have ProductCard add a
 * real variantId (which requires catalog.ts to also select product_variants(id)
 * for the listing query).
 */
export async function resolveOrderItems(items: CartItem[]): Promise<ResolveOrderItemsResult> {
  if (items.length === 0) return { resolved: [], skipped: [] };

  const admin = createAdminSupabaseClient();
  const slugs = [...new Set(items.map((item) => item.slug))];

  const { data, error } = await admin
    .schema("luxury_finds")
    .from("products")
    .select("id, slug, name, is_public, is_active, product_variants(id, price_cents, is_active)")
    .in("slug", slugs);

  if (error) throw new Error(`No fue posible validar los productos del carrito: ${error.message}`);

  const bySlug = new Map<string, ProductRow>();
  for (const row of (data ?? []) as unknown as ProductRow[]) {
    if (row.slug) bySlug.set(row.slug, row);
  }

  const resolved: ResolvedOrderItem[] = [];
  const skipped: Array<{ slug: string; name: string }> = [];

  for (const item of items) {
    const product = bySlug.get(item.slug);
    if (!product || !product.is_public || !product.is_active) {
      skipped.push({ slug: item.slug, name: item.name });
      continue;
    }

    const activeVariants = product.product_variants.filter((v) => v.is_active);
    const variant = item.variantId
      ? activeVariants.find((v) => v.id === item.variantId)
      : activeVariants[0];

    if (!variant) {
      skipped.push({ slug: item.slug, name: item.name });
      continue;
    }

    resolved.push({
      productId: product.id,
      variantId: variant.id,
      quantity: item.quantity,
      unitPriceCents: variant.price_cents,
      name: product.name,
    });
  }

  return { resolved, skipped };
}

/**
 * Whole-cart check: WEEKLY_PLAN is only offered at checkout when EVERY line is
 * a product an admin has explicitly flagged (products.weekly_plan_eligible,
 * added in database/migrations/004_weekly_plan_checkout.sql). Mixing an
 * eligible and a non-eligible product in one cart falls back to a single FULL
 * payment for the whole order rather than splitting the order in two.
 */
export async function checkWeeklyPlanEligibility(items: CartItem[]): Promise<boolean> {
  if (!items.length) return false;

  const admin = createAdminSupabaseClient();
  const slugs = [...new Set(items.map((item) => item.slug))];

  const { data, error } = await admin
    .schema("luxury_finds")
    .from("products")
    .select("slug, is_public, is_active, weekly_plan_eligible")
    .in("slug", slugs);
  if (error) return false;

  const bySlug = new Map((data ?? []).map((row) => [row.slug as string, row]));
  return items.every((item) => {
    const product = bySlug.get(item.slug);
    return Boolean(product?.is_public && product?.is_active && product?.weekly_plan_eligible);
  });
}
