// Maw Maw Beauty adapter (Tiendanube / mitiendanube).
//
// HOW THE CATALOGUE IS READ, AND WHY THIS WAY
//
// Tiendanube renders its grid server-side and, on every product card, prints the
// COMPLETE variant array as a `data-variants` attribute:
//
//   <div class="js-product-container" data-variants="[{&quot;product_id&quot;:...,
//        &quot;price_number_raw&quot;:121000,&quot;compare_at_price_number_raw&quot;:128500,
//        &quot;option0&quot;:&quot;Finest Hour&quot;,&quot;sku&quot;:...,&quot;available&quot;:true,...}]">
//
// That is the same JSON the product page exposes as `LS.variants`. So the whole
// catalogue - prices, offers, stock, SKUs, options, images - can be read from
// the paginated listing alone: ~110 requests instead of ~2,200 product pages
// (which are 1.2 MB each). No headless browser, no lazy-loading problem: the
// grid's "load more" simply requests the next `?page=N`, which we request too.
//
// `?results_only=true` is the fragment the theme's own pagination fetches; it
// carries the same cards with a third of the bytes.
//
// The one thing the card does NOT carry is the brand. It is recovered with a
// second cheap pass over /marcas/<brand>/ (each brand page is the same grid
// fragment), which is worth doing because brand + normalised name is the third
// tier of the deduplicator. That pass is skipped on incremental runs, where the
// products are already matched and their brand already stored.

import { fetchText } from "../http";
import {
  cleanProductName,
  decodeEntities,
  looksLikePreorder,
  slugify,
} from "../normalize";
import type { Availability, SourceProduct, SourceVariant } from "../types";

const ORIGIN = "https://mawmawbeauty.com";
const LISTING_PATH = "/productos/";
const BRANDS_PATH = "/marcas/";

/** Hard stop so a pagination bug can never turn into an unbounded crawl. */
const MAX_LISTING_PAGES = 400;
const MAX_BRAND_PAGES_EACH = 40;

/** Shape of one entry of Tiendanube's `data-variants` / `LS.variants` array. */
type TiendanubeVariant = {
  product_id?: number;
  id?: number;
  sku?: string | null;
  barcode?: string | null;
  price_number_raw?: number | null;
  compare_at_price_number_raw?: number | null;
  has_promotional_price?: boolean;
  promotional_price_number?: number | null;
  stock?: number | null;
  available?: boolean;
  is_visible?: boolean;
  contact?: boolean;
  option0?: string | null;
  option1?: string | null;
  option2?: string | null;
  image_url?: string | null;
};

function unescapeAttribute(value: string): string {
  return decodeEntities(value.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&"));
}

function absoluteImage(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = url.replace(/\\\//g, "/").trim();
  if (!clean) return null;
  if (clean.startsWith("//")) return `https:${clean}`;
  if (clean.startsWith("http")) return clean;
  return `${ORIGIN}${clean.startsWith("/") ? "" : "/"}${clean}`;
}

/**
 * Tiendanube quotes prices two different ways in the same object:
 *   price_number_raw            integer cents, the price actually charged
 *   compare_at_price_number_raw integer cents, the crossed-out list price
 *   promotional_price_number    a float in currency units, used by some themes
 *
 * The brief needs the CURRENT price for the MAX() comparison plus the regular
 * and sale prices stored separately, so all three are resolved here.
 */
function readPrices(variant: TiendanubeVariant): {
  priceCents: number | null;
  regularPriceCents: number | null;
  salePriceCents: number | null;
} {
  const current =
    typeof variant.price_number_raw === "number" && Number.isFinite(variant.price_number_raw)
      ? Math.round(variant.price_number_raw)
      : null;
  const compareAt =
    typeof variant.compare_at_price_number_raw === "number" && Number.isFinite(variant.compare_at_price_number_raw)
      ? Math.round(variant.compare_at_price_number_raw)
      : null;
  const promotional =
    variant.has_promotional_price && typeof variant.promotional_price_number === "number"
      ? Math.round(variant.promotional_price_number * 100)
      : null;

  // The promotional price, when the theme sets one, is what the customer pays.
  const priceCents = promotional ?? current;

  // compare_at above the current price means "this is on offer": the higher
  // number is the regular price and the current one is the sale price.
  if (priceCents !== null && compareAt !== null && compareAt > priceCents) {
    return { priceCents, regularPriceCents: compareAt, salePriceCents: priceCents };
  }
  return { priceCents, regularPriceCents: priceCents, salePriceCents: null };
}

function variantAvailability(variant: TiendanubeVariant): Availability {
  if (variant.available === false) return "out_of_stock";
  if (variant.available === true) return "in_stock";
  if (typeof variant.stock === "number") return variant.stock > 0 ? "in_stock" : "out_of_stock";
  return "unknown";
}

function optionValues(variant: TiendanubeVariant): string[] {
  return [variant.option0, variant.option1, variant.option2]
    .map((value) => (value ?? "").toString().trim())
    .filter(Boolean)
    .map((value) => decodeEntities(value));
}

function toSourceVariant(raw: TiendanubeVariant, index: number, onDemand: boolean): SourceVariant {
  const options = optionValues(raw);
  const { priceCents, regularPriceCents, salePriceCents } = readPrices(raw);
  const attributes: Record<string, string> = {};
  options.forEach((value, position) => {
    attributes[`opcion${position + 1}`] = value;
  });

  const availability = variantAvailability(raw);
  return {
    externalVariantId: raw.id != null ? String(raw.id) : String(index),
    // "Única" mirrors what the existing catalogue already uses for a product
    // that has no options, so a matched product does not gain a second variant
    // row that only differs in its label.
    name: options.length ? options.join(" / ") : "Única",
    attributes,
    sku: raw.sku && String(raw.sku).trim() ? String(raw.sku).trim() : null,
    barcode: raw.barcode && String(raw.barcode).trim() ? String(raw.barcode).trim() : null,
    priceCents,
    regularPriceCents,
    salePriceCents,
    availability: onDemand && availability === "out_of_stock" ? "backorder" : availability,
    imageUrl: absoluteImage(raw.image_url),
    // `contact: true` is Tiendanube's "price on request"; publishing that at $0
    // would be worse than leaving it out of the MAX() rule.
    needsPriceReview: priceCents === null || priceCents <= 0 || raw.contact === true,
  };
}

const ESCAPED_ORIGIN = ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `<a href="…/productos/slug/" title="Nombre visible" …>` inside a grid card. */
const PRODUCT_LINK_RE = new RegExp(`href="(${ESCAPED_ORIGIN}/productos/[^"]+)"\\s+title="([^"]*)"`);

type ParsedCard = { externalProductId: string; url: string; rawName: string; variants: TiendanubeVariant[] };

/** Splits one listing fragment into cards and reads the payload of each. */
export function parseListingFragment(html: string): ParsedCard[] {
  const cards: ParsedCard[] = [];
  const starts: number[] = [];
  const cardStart = /<div\b[^>]*\bclass="[^"]*js-item-product[^"]*"[^>]*>/g;
  for (let match = cardStart.exec(html); match; match = cardStart.exec(html)) starts.push(match.index);

  for (let i = 0; i < starts.length; i += 1) {
    const block = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length);

    const idMatch = /data-product-id="(\d+)"/.exec(block);
    if (!idMatch) continue;
    const externalProductId = idMatch[1];

    const variantsMatch = /data-variants="([^"]*)"/.exec(block);
    if (!variantsMatch) continue;
    let variants: TiendanubeVariant[];
    try {
      const parsed: unknown = JSON.parse(unescapeAttribute(variantsMatch[1]));
      if (!Array.isArray(parsed)) continue;
      variants = parsed as TiendanubeVariant[];
    } catch {
      continue;
    }

    const linkMatch = PRODUCT_LINK_RE.exec(block);
    const url = linkMatch ? linkMatch[1] : `${ORIGIN}${LISTING_PATH}`;
    const rawName = linkMatch ? decodeEntities(linkMatch[2]) : "";

    cards.push({ externalProductId, url, rawName, variants });
  }
  return cards;
}

function cardToProduct(card: ParsedCard, brand: string | null, categories: string[]): SourceProduct | null {
  const visible = card.variants.filter((variant) => variant.is_visible !== false);
  const usable = visible.length ? visible : card.variants;
  if (!usable.length) return null;

  const onDemand = looksLikePreorder(card.rawName, card.url);
  const variants = usable.map((raw, index) => toSourceVariant(raw, index, onDemand));

  const images = Array.from(
    new Set(variants.map((variant) => variant.imageUrl).filter((url): url is string => Boolean(url))),
  );

  const anyInStock = variants.some((variant) => variant.availability === "in_stock");
  const availability: Availability = anyInStock ? "in_stock" : onDemand ? "backorder" : "out_of_stock";

  return {
    source: "mawmaw",
    externalProductId: card.externalProductId,
    url: card.url,
    name: cleanProductName(card.rawName) || card.rawName || `Producto ${card.externalProductId}`,
    rawName: card.rawName,
    brand,
    categories,
    description: null,
    shortDescription: null,
    images,
    variants,
    onDemand,
    availability,
  };
}

function listingUrl(path: string, page: number): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${ORIGIN}${path}${separator}page=${page}&results_only=true`;
}

/**
 * `?results_only=true` content-negotiates: asked for HTML it returns the bare
 * grid fragment, but asked for JSON it returns `{"html": "<div …>"}` with the
 * markup escaped inside. We ask for HTML, and still unwrap the JSON form so a
 * change of mind at the storefront cannot silently return "zero products".
 */
function unwrapFragment(body: string): string {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("{")) return body;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof (parsed as { html?: unknown }).html === "string") {
      return (parsed as { html: string }).html;
    }
  } catch {
    // Not JSON after all; fall through and parse it as markup.
  }
  return body;
}

async function fetchFragment(url: string): Promise<string> {
  return unwrapFragment(await fetchText(url, { accept: "text/html" }));
}

/**
 * Maps every product id of the store to its brand by walking /marcas/<brand>/.
 * A product listed under several brand pages keeps the first one seen; the pages
 * are visited in alphabetical order so that choice is at least deterministic.
 */
async function buildBrandIndex(onError: (stage: string, message: string) => void): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let indexHtml: string;
  try {
    indexHtml = await fetchText(`${ORIGIN}${BRANDS_PATH}`, { accept: "text/html" });
  } catch (error) {
    onError("mawmaw:brands", error instanceof Error ? error.message : String(error));
    return index;
  }

  const linkRe = new RegExp(`href="(${ESCAPED_ORIGIN}/marcas/([^"/?#]+)/)"`, "g");
  const brands = new Map<string, string>();
  for (let match = linkRe.exec(indexHtml); match; match = linkRe.exec(indexHtml)) {
    // Only depth-1 brand pages; deeper URLs are a brand's own sub-collections
    // and would just re-list the same products.
    brands.set(match[1], match[2]);
  }

  for (const [href, slug] of [...brands.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
    const path = href.slice(ORIGIN.length);
    let label: string | null = null;
    for (let page = 1; page <= MAX_BRAND_PAGES_EACH; page += 1) {
      let html: string;
      try {
        html = await fetchFragment(listingUrl(path, page));
      } catch (error) {
        onError(`mawmaw:brand:${slug}`, error instanceof Error ? error.message : String(error));
        break;
      }
      const cards = parseListingFragment(html);
      if (!cards.length) break;
      if (!label) label = brandLabelFromSlug(slug);
      for (const card of cards) if (!index.has(card.externalProductId)) index.set(card.externalProductId, label);
      if (cards.length < 20) break;
    }
  }
  return index;
}

/**
 * "anastasia-beverly-hills" -> "Anastasia Beverly Hills". The storefront does not
 * print the brand's display name anywhere the grid fragment can see, and the
 * deduplicator compares brands through brandKey() (accent- and case-insensitive,
 * punctuation collapsed), so a title-cased slug is an exact-enough label.
 */
function brandLabelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

export type MawMawOptions = {
  /** Recover brands with the extra /marcas/ pass. Full runs only. */
  withBrands?: boolean;
  maxPages?: number;
  onError?: (stage: string, message: string) => void;
};

/**
 * Yields the catalogue one listing page at a time (20 products), so the caller
 * can process it as a batch and keep a bounded amount of memory.
 */
export async function* iterateMawMawProducts(
  options: MawMawOptions = {},
): AsyncGenerator<SourceProduct[], void, undefined> {
  const onError = options.onError ?? (() => {});
  const brandIndex = options.withBrands ? await buildBrandIndex(onError) : new Map<string, string>();
  const maxPages = Math.min(options.maxPages ?? MAX_LISTING_PAGES, MAX_LISTING_PAGES);
  const seen = new Set<string>();
  const failedPages: number[] = [];

  const loadCards = async (page: number) => {
    try {
      return parseListingFragment(await fetchFragment(listingUrl(LISTING_PATH, page)));
    } catch (error) {
      onError(`mawmaw:listing:${page}`, error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const toBatch = (cards: ParsedCard[]) => {
    const batch: SourceProduct[] = [];
    for (const card of cards) {
      // The grid repeats a product across pages when the store re-orders items
      // mid-crawl; the id set makes that harmless.
      if (seen.has(card.externalProductId)) continue;
      seen.add(card.externalProductId);
      const product = cardToProduct(card, brandIndex.get(card.externalProductId) ?? null, []);
      if (product) batch.push(product);
    }
    return batch;
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const cards = await loadCards(page);
    if (cards === null) {
      // Remembered, not skipped - see the retry pass below.
      failedPages.push(page);
      continue;
    }
    if (!cards.length) break;
    const batch = toBatch(cards);
    if (batch.length) yield batch;
  }

  // A page that failed the first time gets one more chance before the run
  // declares the catalogue finished. Without this, a transient network blip in
  // the middle of the crawl silently truncates the import: the next page comes
  // back empty, "empty" reads as "end of catalogue", and everything after the
  // blip is never seen.
  for (const page of failedPages) {
    const cards = await loadCards(page);
    if (!cards?.length) continue;
    const batch = toBatch(cards);
    if (batch.length) yield batch;
  }
}

/** Canonical slug for a Maw Maw product, used when creating a new LF product. */
export function mawMawSlug(product: SourceProduct): string {
  const fromUrl = /\/productos\/([^/?#]+)/.exec(product.url)?.[1];
  return slugify(fromUrl ? decodeURIComponent(fromUrl) : product.name);
}
