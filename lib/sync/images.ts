// Copies a source storefront's product photos into our own bucket.
//
// WHY THE ENGINE NEEDED THIS
//
// Both adapters have always captured image URLs (SourceProduct.images,
// SourceVariant.imageUrl) but lib/sync/engine.ts never read either field, so
// every product the sync created was published without a photo - permanently,
// because a later run would match the product and never look at its images
// again. 85 of the 123 imageless products in the live catalogue were created by
// a single Maw Maw run that way.
//
// WE COPY, WE DO NOT HOTLINK. The storefront's URL is not stored as the image
// source: the bytes are downloaded and re-uploaded to PRODUCT_IMAGE_BUCKET, the
// same bucket the admin panel uploads to and the public catalogue reads from
// (lib/supabase/catalog.ts). Hotlinking would put our storefront at the mercy of
// another store's CDN and break the moment a product is delisted there.
//
// FAILURE POLICY, INHERITED FROM THE ENGINE: an image is a nice-to-have. A URL
// that 404s, a host that times out, a response that is not actually an image -
// none of them may cost us the product. Every failure is recorded through the
// run's error log and the product is created regardless.

import { adminStorage, MAX_PRODUCT_IMAGES, PRODUCT_IMAGE_BUCKET } from "../supabase/business";
import { fetchBinary, mapWithConcurrency } from "./http";
import type { SourceProduct } from "./types";

/**
 * Six at a time. Measured against the live stores: downloading and uploading one
 * ~18 KB storefront image costs ~350ms serially but ~130ms at concurrency 6,
 * which is what makes three images per product affordable inside a 52s budget.
 */
export const IMAGE_CONCURRENCY = 6;

/** Mirrors the admin panel's own upload guard in app/admin/productos/actions.ts. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Storefront CDNs sometimes answer a generic content-type; the path decides then. */
const EXTENSION_BY_SUFFIX: Record<string, string> = {
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
};

function extensionFor(contentType: string, url: string): string | null {
  const byType = IMAGE_EXTENSIONS[contentType];
  if (byType) return byType;
  // Only consult the URL when the server did not commit to an image type at all.
  // A server that says "text/html" is serving an error page, not a mislabelled
  // photo, and must not be rescued by its file extension.
  if (contentType && !contentType.startsWith("image/")) return null;
  try {
    const suffix = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSION_BY_SUFFIX[suffix] ?? null;
  } catch {
    return null;
  }
}

/**
 * The photos worth copying for one source product, best first and de-duplicated.
 * Falls back to the variants' own images when the product-level list is empty,
 * which is the normal shape for Maw Maw: its grid card carries a per-variant
 * image_url and no product-level gallery.
 */
export function imageCandidates(product: SourceProduct, limit = MAX_PRODUCT_IMAGES): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: string | null | undefined) => {
    const clean = (url ?? "").trim();
    if (!clean || seen.has(clean) || out.length >= limit) return;
    if (!/^https?:\/\//i.test(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  for (const url of product.images) push(url);
  for (const variant of product.variants) push(variant.imageUrl);
  return out;
}

export type StoredImage = { storage_key: string; sort_order: number };

export type ImageFetchOutcome = {
  stored: StoredImage[];
  /** One message per image that could not be copied, for the run's error log. */
  failures: string[];
};

/**
 * Downloads up to `limit` photos and uploads them to the catalogue bucket.
 * Does NOT touch the database - the caller inserts the product_images rows, so
 * this stays usable from both the "new product" and the "backfill" path.
 */
export async function copyProductImages(
  product: SourceProduct,
  productId: string,
  limit = MAX_PRODUCT_IMAGES,
): Promise<ImageFetchOutcome> {
  const urls = imageCandidates(product, limit);
  if (!urls.length) return { stored: [], failures: [] };

  const storage = adminStorage();
  const results = await mapWithConcurrency(urls, IMAGE_CONCURRENCY, async (url, index) => {
    try {
      const { bytes, contentType } = await fetchBinary(url, { maxBytes: MAX_IMAGE_BYTES, retries: 1 });
      const extension = extensionFor(contentType, url);
      if (!extension) {
        return { error: `${url}: el servidor respondió "${contentType || "sin tipo"}", que no es una imagen` };
      }
      // Same key shape as the admin panel's uploadImages(): <product id>/<uuid>.
      const key = `${productId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await storage.from(PRODUCT_IMAGE_BUCKET).upload(key, bytes, {
        contentType: `image/${extension === "jpg" ? "jpeg" : extension}`,
        upsert: false,
      });
      if (error) return { error: `${url}: ${error.message}` };
      return { image: { storage_key: key, sort_order: index } satisfies StoredImage };
    } catch (error) {
      return { error: `${url}: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  const stored: StoredImage[] = [];
  const failures: string[] = [];
  for (const result of results) {
    if ("image" in result && result.image) stored.push(result.image);
    else if ("error" in result && result.error) failures.push(result.error);
  }
  // sort_order must stay dense and start at 0 even when an image in the middle
  // failed, or the storefront would render a gap as the "first" photo.
  stored.forEach((image, position) => {
    image.sort_order = position;
  });
  return { stored, failures };
}
