// Oskin adapter (WooCommerce).
//
// HOW THE CATALOGUE IS READ, AND WHY THIS WAY
//
// The desktop prototype in C:\Users\rutil\Desktop\oskin_luxury_finds_pipeline
// drove a Playwright browser over /shop/. That is not usable here: this sync has
// to run inside a serverless function every 15 minutes. It turns out it is also
// unnecessary - the store has WooCommerce Blocks installed, so the public,
// unauthenticated Store API answers everything we need:
//
//   GET /wp-json/wc/store/v1/products?per_page=100&page=N&orderby=id&order=asc
//        -> 100 products per request, with X-WP-Total / X-WP-TotalPages headers,
//           prices already in integer minor units, brands, categories, images,
//           stock and backorder flags, and the id + attributes of each variation
//   GET /wp-json/wc/store/v1/products/<variation id>
//        -> that single variation's own price and stock
//
// Measured against the live store while writing this: 3,506 products over 36
// pages, ~66% of them variable with ~4.5 variations each.
//
// VARIATION FETCHES ARE THE EXPENSIVE PART, so they are skipped whenever the
// parent's `prices.price_range` proves every variation costs the same (null
// range, or min == max). That was true for ~21% of variable products on the
// first page and costs nothing when it is false.
//
// `include=<variation ids>` does NOT work as a bulk shortcut - the Store API's
// product collection excludes variations, and returns an empty array. Verified
// against the live store, so please do not "optimise" it back in.
//
// Note also that oskinmx.com forces a TLS renegotiation that Node's global
// fetch refuses; lib/sync/http.ts handles that transparently.

import { fetchText, mapWithConcurrency } from "../http";
import { cleanProductName, looksLikePreorder, slugify, stripHtml } from "../normalize";
import type { Availability, SourceProduct, SourceVariant } from "../types";

const ORIGIN = "https://oskinmx.com";
const STORE_API = `${ORIGIN}/wp-json/wc/store/v1`;
const PER_PAGE = 100;
const MAX_PAGES = 200;
const VARIATION_CONCURRENCY = 6;

type StorePrices = {
  price?: string | null;
  regular_price?: string | null;
  sale_price?: string | null;
  price_range?: { min_amount?: string | null; max_amount?: string | null } | null;
  currency_minor_unit?: number;
};

type StoreVariationRef = { id: number; attributes?: Array<{ name?: string; value?: string }> };

type StoreProduct = {
  id: number;
  name?: string;
  slug?: string;
  parent?: number;
  type?: string;
  variation?: string;
  permalink?: string;
  sku?: string | null;
  short_description?: string | null;
  description?: string | null;
  on_sale?: boolean;
  prices?: StorePrices;
  images?: Array<{ src?: string | null }>;
  categories?: Array<{ name?: string }>;
  brands?: Array<{ name?: string }>;
  attributes?: Array<{ name?: string; taxonomy?: string | null; has_variations?: boolean; terms?: Array<{ name?: string; slug?: string }> }>;
  variations?: StoreVariationRef[];
  is_in_stock?: boolean;
  is_on_backorder?: boolean;
};

/**
 * Store API money is a string of minor units ("98000" = $980.00) scaled by
 * `currency_minor_unit`. We store cents, so anything that is not a 2-decimal
 * currency is rescaled rather than trusted blindly.
 */
function toCents(amount: string | null | undefined, minorUnit = 2): number | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const raw = Number(amount);
  if (!Number.isFinite(raw)) return null;
  const cents = minorUnit === 2 ? raw : raw * 10 ** (2 - minorUnit);
  return Math.round(cents);
}

function readPrices(prices: StorePrices | undefined): {
  priceCents: number | null;
  regularPriceCents: number | null;
  salePriceCents: number | null;
} {
  const minor = prices?.currency_minor_unit ?? 2;
  const price = toCents(prices?.price, minor);
  const regular = toCents(prices?.regular_price, minor);
  const sale = toCents(prices?.sale_price, minor);
  // WooCommerce reports sale_price == price when nothing is discounted; a real
  // offer is only the case where the regular price sits above what is charged.
  const onOffer = price !== null && regular !== null && regular > price;
  return {
    priceCents: price,
    regularPriceCents: regular ?? price,
    salePriceCents: onOffer ? (sale ?? price) : null,
  };
}

function availabilityOf(product: Pick<StoreProduct, "is_in_stock" | "is_on_backorder">): Availability {
  if (product.is_on_backorder) return "backorder";
  if (product.is_in_stock === true) return "in_stock";
  if (product.is_in_stock === false) return "out_of_stock";
  return "unknown";
}

/**
 * The existing Luxury Finds catalogue - imported from Oskin by the earlier
 * pipeline - stores variant names as the attribute TERM SLUG ("full-size-275-ml",
 * "travel-size-10-ml") and "Única" for products without options. Producing the
 * same shape here is what lets the deduplicator recognise those 3,500-odd
 * products instead of creating a second copy of every one of them.
 */
function variationName(reference: StoreVariationRef): { name: string; attributes: Record<string, string> } {
  const attributes: Record<string, string> = {};
  const values: string[] = [];
  for (const attribute of reference.attributes ?? []) {
    const value = (attribute.value ?? "").trim();
    if (!value) continue;
    const key = attributeKey(attribute.name);
    attributes[key] = value;
    values.push(value);
  }
  return { name: values.length ? values.join(" / ") : "Única", attributes };
}

/** "Tamaño" -> "pa_tamano", matching the taxonomy keys already in the database. */
function attributeKey(name: string | undefined): string {
  const slug = slugify(name ?? "opcion").replace(/-/g, "_");
  return slug ? `pa_${slug}` : "pa_opcion";
}

function imagesOf(product: StoreProduct): string[] {
  return Array.from(
    new Set((product.images ?? []).map((image) => (image.src ?? "").trim()).filter(Boolean)),
  );
}

async function fetchVariation(id: number): Promise<StoreProduct | null> {
  const body = await fetchText(`${STORE_API}/products/${id}`, { accept: "application/json" });
  const parsed: unknown = JSON.parse(body);
  return parsed && typeof parsed === "object" ? (parsed as StoreProduct) : null;
}

async function buildVariants(
  product: StoreProduct,
  onDemand: boolean,
  onError: (stage: string, message: string) => void,
): Promise<SourceVariant[]> {
  const parentPrices = readPrices(product.prices);
  const parentAvailability = availabilityOf(product);
  const references = product.variations ?? [];

  if (product.type !== "variable" || references.length === 0) {
    return [
      {
        externalVariantId: "",
        name: "Única",
        attributes: {},
        sku: product.sku && product.sku.trim() ? product.sku.trim() : null,
        barcode: null,
        ...parentPrices,
        availability: parentAvailability,
        imageUrl: imagesOf(product)[0] ?? null,
        needsPriceReview: parentPrices.priceCents === null || parentPrices.priceCents <= 0,
      },
    ];
  }

  // Every variation costs the same -> the parent's price is each variation's
  // price and no extra request is needed. See the note at the top of the file.
  const range = product.prices?.price_range;
  const uniformPrice = !range || range.min_amount === range.max_amount;

  if (uniformPrice) {
    return references.map((reference) => {
      const { name, attributes } = variationName(reference);
      return {
        externalVariantId: String(reference.id),
        name,
        attributes,
        sku: null,
        barcode: null,
        ...parentPrices,
        availability: parentAvailability,
        imageUrl: imagesOf(product)[0] ?? null,
        needsPriceReview: parentPrices.priceCents === null || parentPrices.priceCents <= 0,
      };
    });
  }

  const details = await mapWithConcurrency(references, VARIATION_CONCURRENCY, async (reference) => {
    try {
      return await fetchVariation(reference.id);
    } catch (error) {
      onError(`oskin:variation:${reference.id}`, error instanceof Error ? error.message : String(error));
      return null;
    }
  });

  return references.map((reference, index) => {
    const detail = details[index];
    const { name, attributes } = variationName(reference);
    // A variation whose own request failed falls back to the parent price
    // rather than being dropped: losing the row would look like the variant
    // disappeared from the store, which would be a worse lie than a stale price.
    const prices = detail ? readPrices(detail.prices) : parentPrices;
    const availability = detail ? availabilityOf(detail) : parentAvailability;
    return {
      externalVariantId: String(reference.id),
      name,
      attributes,
      sku: detail?.sku && detail.sku.trim() ? detail.sku.trim() : null,
      barcode: null,
      ...prices,
      availability: onDemand && availability === "out_of_stock" ? "backorder" : availability,
      imageUrl: detail ? (imagesOf(detail)[0] ?? imagesOf(product)[0] ?? null) : (imagesOf(product)[0] ?? null),
      needsPriceReview: prices.priceCents === null || prices.priceCents <= 0,
    };
  });
}

async function toSourceProduct(
  product: StoreProduct,
  onError: (stage: string, message: string) => void,
): Promise<SourceProduct | null> {
  if (!product?.id) return null;
  const rawName = (product.name ?? "").trim();
  if (!rawName) return null;

  const onDemand = looksLikePreorder(rawName) || product.is_on_backorder === true;
  const variants = await buildVariants(product, onDemand, onError);

  return {
    source: "oskin",
    externalProductId: String(product.id),
    url: product.permalink ?? `${ORIGIN}/producto/${product.slug ?? product.id}/`,
    name: cleanProductName(rawName) || rawName,
    rawName,
    brand: product.brands?.[0]?.name?.trim() || null,
    categories: (product.categories ?? []).map((category) => (category.name ?? "").trim()).filter(Boolean),
    description: stripHtml(product.description) || null,
    shortDescription: stripHtml(product.short_description) || null,
    images: imagesOf(product),
    variants,
    onDemand,
    availability: availabilityOf(product),
  };
}

export type OskinOptions = {
  maxPages?: number;
  onError?: (stage: string, message: string) => void;
};

/**
 * Yields the catalogue one Store API page at a time (100 products), so the
 * caller can process it as a batch. Pagination stops on the first empty page,
 * which is also what happens past the last page.
 */
export async function* iterateOskinProducts(
  options: OskinOptions = {},
): AsyncGenerator<SourceProduct[], void, undefined> {
  const onError = options.onError ?? (() => {});
  const maxPages = Math.min(options.maxPages ?? MAX_PAGES, MAX_PAGES);
  const seen = new Set<string>();
  const failedPages: number[] = [];

  async function loadPage(page: number): Promise<StoreProduct[] | null> {
    try {
      const body = await fetchText(
        `${STORE_API}/products?per_page=${PER_PAGE}&page=${page}&orderby=id&order=asc`,
        { accept: "application/json" },
      );
      const parsed: unknown = JSON.parse(body);
      if (!Array.isArray(parsed)) {
        onError(`oskin:list:${page}`, "La respuesta del Store API no fue una lista");
        return null;
      }
      return parsed as StoreProduct[];
    } catch (error) {
      onError(`oskin:list:${page}`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function toBatch(list: StoreProduct[]): Promise<SourceProduct[]> {
    const batch: SourceProduct[] = [];
    for (const raw of list) {
      const id = String(raw.id);
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        const product = await toSourceProduct(raw, onError);
        if (product) batch.push(product);
      } catch (error) {
        onError(`oskin:product:${id}`, error instanceof Error ? error.message : String(error));
      }
    }
    return batch;
  }

  for (let page = 1; page <= maxPages; page += 1) {
    const list = await loadPage(page);
    if (list === null) {
      // A page that failed is remembered, not skipped. Past the last page
      // WooCommerce answers 400, which fails the same way, so the retry pass
      // below is what tells a transient outage apart from the end of the
      // catalogue: a page that fails twice and yields nothing simply had
      // nothing to give.
      failedPages.push(page);
      continue;
    }
    // An empty page is the end of the catalogue - but only when no earlier page
    // failed, because otherwise "empty" might just be where a network outage
    // started and we would silently import half a catalogue.
    if (!list.length) break;

    const batch = await toBatch(list);
    if (batch.length) yield batch;
  }

  for (const page of failedPages) {
    const list = await loadPage(page);
    if (!list?.length) continue;
    const batch = await toBatch(list);
    if (batch.length) yield batch;
  }
}

/** Canonical slug for an Oskin product, used when creating a new LF product. */
export function oskinSlug(product: SourceProduct): string {
  return slugify(product.name);
}
