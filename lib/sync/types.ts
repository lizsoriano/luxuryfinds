// Shared vocabulary for the external catalogue synchronisation.
//
// Every storefront adapter (lib/sync/sources/*) is responsible for turning its
// own API/HTML into these shapes. Nothing downstream - matching, the price rule,
// the writer - knows whether the data came from Tiendanube or WooCommerce.

export const SYNC_SOURCES = ["mawmaw", "oskin"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

export const SOURCE_LABELS: Record<SyncSource, string> = {
  mawmaw: "Maw Maw Beauty",
  oskin: "Oskin",
};

export const SOURCE_HOMEPAGES: Record<SyncSource, string> = {
  mawmaw: "https://mawmawbeauty.com",
  oskin: "https://oskinmx.com",
};

export type SyncType = "INITIAL" | "INCREMENTAL" | "MANUAL";
export type SyncStatus = "running" | "completed" | "partial" | "failed";

export type Availability = "in_stock" | "out_of_stock" | "backorder" | "unknown";

/** One buyable option of a source product. Single-option products get exactly one. */
export type SourceVariant = {
  /** '' when the store models the product without variations. */
  externalVariantId: string;
  /** Human label, already in the "Atributo: valor" style the catalogue uses. */
  name: string;
  attributes: Record<string, string>;
  sku: string | null;
  barcode: string | null;
  /** What the store charges right now (the sale price when an offer is live). */
  priceCents: number | null;
  regularPriceCents: number | null;
  salePriceCents: number | null;
  availability: Availability;
  imageUrl: string | null;
  /**
   * True when the store did not expose a usable price for this option. Such a
   * row is never published at $0 and never takes part in the MAX() rule.
   */
  needsPriceReview: boolean;
};

export type SourceProduct = {
  source: SyncSource;
  externalProductId: string;
  url: string;
  /** Cleaned display name (no "*PREORDEN*", no "Pre-Order", no stray markers). */
  name: string;
  /** Exactly what the store shows, kept for auditing and for the review queue. */
  rawName: string;
  brand: string | null;
  categories: string[];
  description: string | null;
  shortDescription: string | null;
  images: string[];
  variants: SourceVariant[];
  /** Store sells this on preorder / backorder -> ON_DEMAND in our catalogue. */
  onDemand: boolean;
  availability: Availability;
};

/**
 * One listing page's worth of products, tagged with the page it came from so the
 * engine can persist a checkpoint (see lib/sync/cursor.ts). `retry` marks the
 * adapters' second pass over pages that failed the first time: those arrive out
 * of order and must never be allowed to advance the cursor.
 */
export type SourcePage = {
  page: number;
  products: SourceProduct[];
  retry: boolean;
};

export type SyncError = {
  stage: string;
  externalId?: string;
  message: string;
  at: string;
};

export type SyncCounters = {
  products_scanned: number;
  products_created: number;
  products_matched: number;
  products_updated: number;
  prices_increased: number;
  products_unchanged: number;
  reviews_created: number;
};

export function emptyCounters(): SyncCounters {
  return {
    products_scanned: 0,
    products_created: 0,
    products_matched: 0,
    products_updated: 0,
    prices_increased: 0,
    products_unchanged: 0,
    reviews_created: 0,
  };
}

/** A price move the engine decided on, kept so it can be logged and reported. */
export type PriceMove = {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  oldPriceCents: number;
  newPriceCents: number;
  source: SyncSource;
};
