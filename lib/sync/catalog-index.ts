// Reads the Luxury Finds catalogue into memory once per run and answers the
// only question the sync really has: "do we already sell this?"
//
// THE DEDUPLICATION IS HIERARCHICAL AND DELIBERATELY CONSERVATIVE, in the order
// the brief asks for. The first tier that answers wins; nothing below it is
// consulted:
//
//   0. product_sources          - this exact store row was matched before.
//   1. legacy Oskin image key   - see the long note on loadLegacyOskinIds().
//   2. barcode / UPC / EAN      - exact, digits only, 8-14 digits.
//   3. SKU                      - exact, at least 4 usable characters.
//   4. brand + normalised name  - exact on the normalised key, not fuzzy.
//   5. ambiguous?               - one name contains the other, or >= 85% token
//                                 overlap -> "Revisar coincidencias" queue.
//   6. otherwise                - a genuinely new product, created automatically.
//
// There is no fuzzy auto-merge anywhere: tier 4 is an exact match on a key that
// has been normalised (accents, case, punctuation, store markers, unit spacing),
// which is a very different thing from matching on a similarity score. Tier 5
// only ever asks a human; it never decides.

import { adminDb } from "../supabase/business";
import {
  assessAmbiguity,
  barcodeKey,
  brandKey,
  nameKey,
  skuKey,
  variantKey,
} from "./normalize";
import type { SourceProduct, SourceVariant, SyncSource } from "./types";

const PAGE_SIZE = 1000;

export type CatalogVariant = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price_cents: number;
  is_active: boolean;
};

export type CatalogProduct = {
  id: string;
  name: string;
  slug: string | null;
  brand_id: string | null;
  brandName: string | null;
  is_active: boolean;
};

export type ExistingSourceLink = {
  id: string;
  product_id: string;
  variant_id: string | null;
  source: SyncSource;
  external_product_id: string;
  external_variant_id: string;
  source_price_cents: number | null;
};

/** Reads every row of a table, page by page: PostgREST caps a select at 1000. */
async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const db = adminDb();
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * product_variants.barcode only exists once migration 002/003 has been applied.
 * The sync must still be able to run (and match on SKU and name) before that,
 * so a missing column degrades to "no barcodes" instead of throwing.
 */
async function loadVariants(): Promise<{ variants: CatalogVariant[]; hasBarcodeColumn: boolean }> {
  const withBarcode = "id, product_id, name, sku, barcode, price_cents, is_active";
  try {
    return { variants: await selectAll<CatalogVariant>("product_variants", withBarcode), hasBarcodeColumn: true };
  } catch (error) {
    if (!/barcode/i.test(error instanceof Error ? error.message : "")) throw error;
    const rows = await selectAll<Omit<CatalogVariant, "barcode">>(
      "product_variants",
      "id, product_id, name, sku, price_cents, is_active",
    );
    return { variants: rows.map((row) => ({ ...row, barcode: null })), hasBarcodeColumn: false };
  }
}

/**
 * WHY THE IMAGE STORAGE KEY IS AN IDENTITY SOURCE
 *
 * The 3,507 products already in the catalogue were imported from Oskin by the
 * earlier desktop pipeline, which stored every image under
 *
 *     products/<oskin product id>/<oskin image id>.webp
 *
 * It did not, however, record the Oskin id anywhere else: the variant SKUs it
 * wrote are opaque hashes ("OSKIN-5B6E81FEA5B979"), not Oskin identifiers, and
 * Oskin's own SKU field is empty. Without this mapping the very first Oskin sync
 * would have to fall back to name matching for the entire catalogue, and every
 * product whose title has drifted since the import would be created a second
 * time.
 *
 * Verified against the live database while writing this: 15,723 image rows give
 * a clean 1:1 mapping for 3,469 products - no product points at two Oskin ids
 * and no Oskin id points at two products - so this is used as a high-confidence
 * tier, just below an explicit product_sources link.
 */
async function loadLegacyOskinIds(): Promise<Map<string, string>> {
  const rows = await selectAll<{ product_id: string; storage_key: string | null }>(
    "product_images",
    "product_id, storage_key",
  );
  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    const match = /^products\/(\d+)\//.exec(row.storage_key ?? "");
    if (!match) continue;
    const set = candidates.get(match[1]) ?? new Set<string>();
    set.add(row.product_id);
    candidates.set(match[1], set);
  }
  const index = new Map<string, string>();
  for (const [oskinId, productIds] of candidates) {
    // An Oskin id that somehow points at two products is not an identity any
    // more; drop it and let the lower tiers decide.
    if (productIds.size === 1) index.set(oskinId, [...productIds][0]);
  }
  return index;
}

async function loadExistingLinks(): Promise<{ links: ExistingSourceLink[]; tableExists: boolean }> {
  try {
    const links = await selectAll<ExistingSourceLink>(
      "product_sources",
      "id, product_id, variant_id, source, external_product_id, external_variant_id, source_price_cents",
    );
    return { links, tableExists: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // PGRST205: the table is not in the schema cache, i.e. migration 003 has not
    // been applied yet. Reported, never swallowed - the caller turns this into a
    // visible run error instead of pretending everything matched.
    if (/product_sources/i.test(message) && /schema cache|does not exist/i.test(message)) {
      return { links: [], tableExists: false };
    }
    throw error;
  }
}

export type ReviewState = "PENDING" | "SAME" | "DIFFERENT";

/**
 * The answers an admin already gave in "Revisar coincidencias". Without this the
 * engine would re-open the same question on every run and a product the admin
 * marked "son diferentes" would never actually get created.
 */
async function loadReviewDecisions(): Promise<Map<string, ReviewState>> {
  try {
    const rows = await selectAll<{ source: SyncSource; external_product_id: string; status: ReviewState }>(
      "product_match_reviews",
      "source, external_product_id, status",
    );
    return new Map(rows.map((row) => [`${row.source}:${row.external_product_id}`, row.status]));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/product_match_reviews/i.test(message) && /schema cache|does not exist/i.test(message)) return new Map();
    throw error;
  }
}

export type MatchMethod =
  | "product_source"
  | "legacy_image"
  | "barcode"
  | "sku"
  | "brand_name"
  | "created";

export type ProductMatch =
  | { kind: "matched"; productId: string; method: MatchMethod }
  | { kind: "ambiguous"; productId: string; candidateName: string; similarity: number; reason: string }
  | { kind: "new" };

export type VariantMatch =
  | { kind: "matched"; variant: CatalogVariant; method: MatchMethod }
  | { kind: "new" };

export class CatalogIndex {
  readonly products = new Map<string, CatalogProduct>();
  readonly variantsByProduct = new Map<string, CatalogVariant[]>();
  readonly hasBarcodeColumn: boolean;
  readonly productSourcesTableExists: boolean;

  private readonly byBarcode = new Map<string, CatalogVariant>();
  private readonly bySku = new Map<string, CatalogVariant>();
  /** normalised name -> product ids. A key shared by two products is ambiguous. */
  private readonly byName = new Map<string, Set<string>>();
  private readonly legacyOskinIds: Map<string, string>;
  /** `${source}:${externalProductId}` -> product id */
  private readonly bySourceProduct = new Map<string, string>();
  /** `${source}:${externalProductId}:${externalVariantId}` -> link */
  private readonly bySourceVariant = new Map<string, ExistingSourceLink>();
  /** product id -> the brand slug we know it by, for the tier-4 sanity check. */
  private readonly brandOf = new Map<string, string>();
  private readonly reviewDecisions: Map<string, ReviewState>;

  private constructor(input: {
    products: CatalogProduct[];
    variants: CatalogVariant[];
    legacyOskinIds: Map<string, string>;
    links: ExistingSourceLink[];
    reviewDecisions: Map<string, ReviewState>;
    hasBarcodeColumn: boolean;
    productSourcesTableExists: boolean;
  }) {
    this.hasBarcodeColumn = input.hasBarcodeColumn;
    this.productSourcesTableExists = input.productSourcesTableExists;
    this.legacyOskinIds = input.legacyOskinIds;
    this.reviewDecisions = input.reviewDecisions;

    for (const product of input.products) {
      this.products.set(product.id, product);
      this.brandOf.set(product.id, brandKey(product.brandName));
      for (const key of nameKeysFor(product.name, product.brandName)) {
        const set = this.byName.get(key) ?? new Set<string>();
        set.add(product.id);
        this.byName.set(key, set);
      }
    }

    for (const variant of input.variants) {
      const list = this.variantsByProduct.get(variant.product_id) ?? [];
      list.push(variant);
      this.variantsByProduct.set(variant.product_id, list);

      const bk = barcodeKey(variant.barcode);
      if (bk && !this.byBarcode.has(bk)) this.byBarcode.set(bk, variant);
      const sk = skuKey(variant.sku);
      if (sk && !this.bySku.has(sk)) this.bySku.set(sk, variant);
    }

    for (const link of input.links) {
      this.bySourceProduct.set(`${link.source}:${link.external_product_id}`, link.product_id);
      this.bySourceVariant.set(
        `${link.source}:${link.external_product_id}:${link.external_variant_id}`,
        link,
      );
    }
  }

  static async load(): Promise<CatalogIndex> {
    const [products, brands, variantsResult, legacyOskinIds, linksResult, reviewDecisions] = await Promise.all([
      selectAll<{ id: string; name: string; slug: string | null; brand_id: string | null; is_active: boolean }>(
        "products",
        "id, name, slug, brand_id, is_active",
      ),
      selectAll<{ id: string; name: string }>("brands", "id, name"),
      loadVariants(),
      loadLegacyOskinIds(),
      loadExistingLinks(),
      loadReviewDecisions(),
    ]);

    const brandNames = new Map(brands.map((brand) => [brand.id, brand.name]));
    return new CatalogIndex({
      products: products.map((product) => ({
        ...product,
        brandName: product.brand_id ? (brandNames.get(product.brand_id) ?? null) : null,
      })),
      variants: variantsResult.variants,
      legacyOskinIds,
      links: linksResult.links,
      reviewDecisions,
      hasBarcodeColumn: variantsResult.hasBarcodeColumn,
      productSourcesTableExists: linksResult.tableExists,
    });
  }

  getLink(source: SyncSource, externalProductId: string, externalVariantId: string): ExistingSourceLink | undefined {
    return this.bySourceVariant.get(`${source}:${externalProductId}:${externalVariantId}`);
  }

  variantsOf(productId: string): CatalogVariant[] {
    return this.variantsByProduct.get(productId) ?? [];
  }

  matchProduct(product: SourceProduct): ProductMatch {
    // Tier 0 - already linked.
    const linked = this.bySourceProduct.get(`${product.source}:${product.externalProductId}`);
    if (linked && this.products.has(linked)) return { kind: "matched", productId: linked, method: "product_source" };

    // Tier 1 - the legacy Oskin image mapping.
    if (product.source === "oskin") {
      const legacy = this.legacyOskinIds.get(product.externalProductId);
      if (legacy && this.products.has(legacy)) {
        return { kind: "matched", productId: legacy, method: "legacy_image" };
      }
    }

    // Tier 2 and 3 - any variant that carries the same barcode or SKU proves the
    // product is the same product.
    for (const variant of product.variants) {
      const bk = barcodeKey(variant.barcode);
      const hit = bk ? this.byBarcode.get(bk) : undefined;
      if (hit) return { kind: "matched", productId: hit.product_id, method: "barcode" };
    }
    for (const variant of product.variants) {
      const sk = skuKey(variant.sku);
      const hit = sk ? this.bySku.get(sk) : undefined;
      if (hit) return { kind: "matched", productId: hit.product_id, method: "sku" };
    }

    // Tier 4 - exact match on the normalised brand + name key.
    const sourceBrand = brandKey(product.brand);
    const candidates = new Set<string>();
    for (const key of nameKeysFor(product.name, product.brand)) {
      for (const productId of this.byName.get(key) ?? []) candidates.add(productId);
    }

    const agreeing = [...candidates].filter((productId) => {
      const existingBrand = this.brandOf.get(productId) ?? "";
      // Brands only disqualify a match when BOTH sides state one and they
      // disagree. Maw Maw's grid does not publish a brand at all, so requiring
      // one would turn every Maw Maw product into a false "new product".
      if (!sourceBrand || !existingBrand) return true;
      return sourceBrand === existingBrand || existingBrand.includes(sourceBrand) || sourceBrand.includes(existingBrand);
    });

    if (agreeing.length === 1) return { kind: "matched", productId: agreeing[0], method: "brand_name" };
    if (agreeing.length > 1) {
      // Same normalised name on two of our own products: we cannot pick one.
      const candidate = this.products.get(agreeing[0]);
      return {
        kind: "ambiguous",
        productId: agreeing[0],
        candidateName: candidate?.name ?? "",
        similarity: 1,
        reason: `El nombre normalizado coincide con ${agreeing.length} productos del catálogo`,
      };
    }

    // An answer the admin already gave in "Revisar coincidencias" outranks a
    // fresh similarity check: "son diferentes" means create it, and a question
    // still open must not be asked again.
    const decision = this.reviewDecisions.get(`${product.source}:${product.externalProductId}`);
    if (decision === "DIFFERENT") return { kind: "new" };
    if (decision === "PENDING") {
      return {
        kind: "ambiguous",
        productId: "",
        candidateName: "",
        similarity: 0,
        reason: "Ya está en la cola de revisión y sigue pendiente",
      };
    }

    // Tier 5 - nearly the same as something we sell? Ask, do not guess.
    const near = this.findNearMatch(product, sourceBrand);
    if (near) return near;

    return { kind: "new" };
  }

  /**
   * Only compares against products of the SAME brand (when the source states
   * one), because scanning 3,500 names for every incoming product would be both
   * slow and a great way to fill the review queue with noise. Without a brand we
   * compare against products that share at least one distinctive token.
   */
  private findNearMatch(product: SourceProduct, sourceBrand: string): ProductMatch | null {
    const key = nameKey(product.name, product.brand);
    const tokens = key.split(" ").filter((token) => token.length >= 4);
    if (!tokens.length) return null;

    const pool = new Set<string>();
    for (const [existingKey, productIds] of this.byName) {
      if (pool.size > 400) break;
      if (!tokens.some((token) => existingKey.includes(token))) continue;
      for (const productId of productIds) {
        if (sourceBrand) {
          const existingBrand = this.brandOf.get(productId) ?? "";
          if (existingBrand && existingBrand !== sourceBrand) continue;
        }
        pool.add(productId);
      }
    }

    let best: { productId: string; name: string; similarity: number; reason: string } | null = null;
    for (const productId of pool) {
      const candidate = this.products.get(productId);
      if (!candidate) continue;
      const verdict = assessAmbiguity(key, nameKey(candidate.name, candidate.brandName));
      if (!verdict.ambiguous) continue;
      if (!best || verdict.similarity > best.similarity) {
        best = { productId, name: candidate.name, similarity: verdict.similarity, reason: verdict.reason };
      }
    }

    return best
      ? {
          kind: "ambiguous",
          productId: best.productId,
          candidateName: best.name,
          similarity: best.similarity,
          reason: best.reason,
        }
      : null;
  }

  /**
   * Variant identity inside an already-matched product. Tono / color / talla are
   * variants of one product, never separate products, so this is what keeps the
   * existing product_variants rows intact instead of appending near-duplicates.
   */
  matchVariant(productId: string, source: SyncSource, externalProductId: string, variant: SourceVariant): VariantMatch {
    const link = this.getLink(source, externalProductId, variant.externalVariantId);
    if (link?.variant_id) {
      const known = this.variantsOf(productId).find((row) => row.id === link.variant_id);
      if (known) return { kind: "matched", variant: known, method: "product_source" };
    }

    const existing = this.variantsOf(productId);
    if (!existing.length) return { kind: "new" };

    const bk = barcodeKey(variant.barcode);
    if (bk) {
      const hit = existing.find((row) => barcodeKey(row.barcode) === bk);
      if (hit) return { kind: "matched", variant: hit, method: "barcode" };
    }

    const sk = skuKey(variant.sku);
    if (sk) {
      const hit = existing.find((row) => skuKey(row.sku) === sk);
      if (hit) return { kind: "matched", variant: hit, method: "sku" };
    }

    const vk = variantKey(variant.name);
    if (vk) {
      const hit = existing.find((row) => variantKey(row.name) === vk);
      if (hit) return { kind: "matched", variant: hit, method: "brand_name" };
    }

    // One option on each side: the same single thing, whatever the two stores
    // decided to call it ("Única" vs "Default" vs "30 ml").
    if (existing.length === 1 && vk === "" ) return { kind: "matched", variant: existing[0], method: "brand_name" };

    return { kind: "new" };
  }

  /** Keeps the in-memory index usable after the writer creates rows. */
  registerProduct(product: CatalogProduct) {
    this.products.set(product.id, product);
    this.brandOf.set(product.id, brandKey(product.brandName));
    for (const key of nameKeysFor(product.name, product.brandName)) {
      const set = this.byName.get(key) ?? new Set<string>();
      set.add(product.id);
      this.byName.set(key, set);
    }
  }

  registerVariant(variant: CatalogVariant) {
    const list = this.variantsByProduct.get(variant.product_id) ?? [];
    list.push(variant);
    this.variantsByProduct.set(variant.product_id, list);
    const bk = barcodeKey(variant.barcode);
    if (bk && !this.byBarcode.has(bk)) this.byBarcode.set(bk, variant);
    const sk = skuKey(variant.sku);
    if (sk && !this.bySku.has(sk)) this.bySku.set(sk, variant);
  }

  registerLink(source: SyncSource, externalProductId: string, productId: string) {
    this.bySourceProduct.set(`${source}:${externalProductId}`, productId);
  }

  updateVariantPrice(variantId: string, productId: string, priceCents: number) {
    const row = this.variantsOf(productId).find((variant) => variant.id === variantId);
    if (row) row.price_cents = priceCents;
  }
}

/**
 * Both stores keep the brand inside the title, but our own catalogue sometimes
 * does not, so a product is indexed under BOTH the raw normalised name and the
 * one with the brand prefix removed. Matching on either is still an exact match
 * on a normalised key - it just tolerates the two spellings.
 */
export function nameKeysFor(name: string, brand: string | null | undefined): string[] {
  const keys = new Set<string>();
  const raw = nameKey(name, null);
  if (raw) keys.add(raw);
  if (brand) {
    const stripped = nameKey(name, brand);
    if (stripped) keys.add(stripped);
  }
  return [...keys];
}
