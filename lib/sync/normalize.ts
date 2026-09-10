// Normalisation and identity helpers for the external catalogue sync.
//
// Ported from the tested desktop pipeline in
// C:\Users\rutil\Desktop\oskin_luxury_finds_pipeline\src\scrape-oskin.mjs
// (name cleaning, slugify, moneyToCents, price-range parsing) and extended with
// the brand/name/variant identity keys the deduplicator needs.
//
// Everything here is pure: no network, no Supabase. That is what makes it
// testable and safe to import from anywhere.

/** Markers both storefronts glue onto product titles. Removed before comparing. */
const NOISE_PATTERNS: RegExp[] = [
  /\*+\s*pre-?\s?ord(?:en|er)\s*\*+/gi,
  /\bpre-?\s?ord(?:en|er)\b/gi,
  /\*+\s*nuevo\s*\*+/gi,
  /\*+\s*new\s*\*+/gi,
  /\*+\s*oferta\s*\*+/gi,
  /\*+\s*agotado\s*\*+/gi,
  /\*+\s*ultimas?\s+piezas?\s*\*+/gi,
  /\*+\s*envio\s+gratis\s*\*+/gi,
  /\(\s*pre-?\s?ord(?:en|er)\s*\)/gi,
  /\[\s*pre-?\s?ord(?:en|er)\s*\]/gi,
];

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&#8217;": "\u2019",
  "&#8216;": "\u2018",
  "&#8220;": "\u201c",
  "&#8221;": "\u201d",
  "&#8211;": "\u2013",
  "&#8212;": "\u2014",
  "&#036;": "$",
  "&hellip;": "\u2026",
  "&ldquo;": "\u201c",
  "&rdquo;": "\u201d",
  "&reg;": "\u00ae",
  "&trade;": "\u2122",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|hellip|ldquo|rdquo|reg|trade|#0?39|#8217|#8216|#8220|#8221|#8211|#8212|#036);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : _m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : _m;
    });
}

export function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  return decodeEntities(
    value
      .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Display name: entities decoded, store markers removed, whitespace collapsed. */
export function cleanProductName(rawName: string): string {
  let name = decodeEntities(rawName ?? "");
  for (const pattern of NOISE_PATTERNS) name = name.replace(pattern, " ");
  return name
    .replace(/[*]{2,}/g, " ")
    .replace(/\s*[-–—|]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** True when the store title itself says the item is sold on preorder. */
export function looksLikePreorder(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => value && /pre-?\s?ord(en|er)|preventa|\bbackorder\b/i.test(value));
}

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Same contract as lib/format.ts slugify (lowercase, accent-free, hyphenated)
 * but without the 60-character clamp, because slugs are made unique against the
 * database afterwards and truncating first causes needless collisions.
 */
export function slugify(value: string, maxLength = 80): string {
  return stripAccents(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/**
 * "$1,234.50" | "1234.5" | "1.234,50" -> 123450 cents. Returns null when there
 * is no number at all, so a missing price is never silently turned into $0.
 */
export function moneyToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  let raw = String(value).replace(/[^\d.,-]/g, "").trim();
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma > lastDot) {
    // European style: 1.234,50
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else {
    raw = raw.replace(/,/g, "");
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

/** "$150.00 - $320.00" -> { minCents, maxCents }. Null when not a range. */
export function parsePriceRange(value: string | null | undefined): { minCents: number; maxCents: number } | null {
  if (!value) return null;
  const text = stripHtml(value);
  const matches = text.match(/\d[\d.,]*/g);
  if (!matches || matches.length < 2) return null;
  const min = moneyToCents(matches[0]);
  const max = moneyToCents(matches[matches.length - 1]);
  if (min === null || max === null || max < min) return null;
  return { minCents: min, maxCents: max };
}

// ---------------------------------------------------------------------------
// Identity keys
// ---------------------------------------------------------------------------

/**
 * Brands arrive spelled every possible way ("THE ORDINARY", "The Ordinary") and
 * the legacy Oskin import stored several of them with the storefront's
 * "Más de X" link text, so that prefix is stripped too. Without this the same
 * brand would produce two identity namespaces and therefore duplicate products.
 */
export function brandKey(brand: string | null | undefined): string {
  if (!brand) return "";
  const cleaned = stripAccents(decodeEntities(brand))
    .toLowerCase()
    .replace(/^\s*(mas de|ver todo en|todo en)\s+/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return cleaned;
}

const UNIT_WORDS = "ml|l|g|gr|kg|mg|oz|fl oz|floz|pcs|pzs|pzas|piezas|ct|un";

/**
 * Comparable form of a product name. Accents, case, punctuation, store markers
 * and unit spacing are all removed so that
 *   "THE ORDINARY Niacinamide 10% + Zinc 1% 30ml *PREORDEN*"
 * and
 *   "The Ordinary  Niacinamide 10 % + Zinc 1 % 30 ML"
 * collapse to the same string. Deliberately conservative: it never drops words.
 */
export function nameKey(name: string, brand?: string | null): string {
  let text = stripAccents(cleanProductName(name)).toLowerCase();

  // A brand repeated inside the title must not make two spellings differ.
  const bKey = brandKey(brand);
  if (bKey) {
    const escaped = bKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[^a-z0-9]+");
    text = text.replace(new RegExp(`^\\s*${escaped}\\b`, "i"), " ");
  }

  text = text
    .replace(/[%]/g, " percent ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9. ]+/g, " ")
    // "30 ml" -> "30ml", "1.7 oz" -> "1.7oz"
    .replace(new RegExp(`(\\d)\\s+(${UNIT_WORDS})\\b`, "g"), "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

/** Variant labels differ in punctuation across stores; compare on the values. */
export function variantKey(name: string | null | undefined): string {
  if (!name) return "";
  const withoutLabel = name.replace(/^[^:]{1,24}:\s*/, "");
  return stripAccents(decodeEntities(withoutLabel))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function skuKey(sku: string | null | undefined): string {
  if (!sku) return "";
  const cleaned = String(sku).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  // 1-3 character "SKUs" are almost always junk ("1", "na", "-") and would
  // merge unrelated products, so they are not accepted as an identity.
  return cleaned.length >= 4 ? cleaned : "";
}

export function barcodeKey(barcode: string | null | undefined): string {
  if (!barcode) return "";
  const digits = String(barcode).replace(/\D/g, "");
  // Real UPC-A/EAN-13/ISBN lengths only.
  return digits.length >= 8 && digits.length <= 14 ? digits : "";
}

/** Identity used when neither barcode nor SKU is available. */
export function compositeKey(brand: string | null | undefined, name: string, variantName?: string | null): string {
  return `${brandKey(brand)}|${nameKey(name, brand)}|${variantKey(variantName)}`;
}

// ---------------------------------------------------------------------------
// Similarity (only used to decide "is this ambiguous?", never to auto-merge)
// ---------------------------------------------------------------------------

export function tokens(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type AmbiguityVerdict = {
  ambiguous: boolean;
  similarity: number;
  reason: string;
};

/**
 * Decides whether two names are close enough that a human should look, WITHOUT
 * ever merging on its own. Two narrow rules only, so the review queue stays the
 * exception the brief asks for:
 *
 *   1. containment - one name is the other plus at most two extra words
 *      ("Rare Beauty Soft Pinch Blush" vs "... Blush Mini")
 *   2. very high token overlap (>= 0.85) between two names of the same brand
 *
 * Anything below that is treated as a genuinely different product and imported.
 */
export function assessAmbiguity(aName: string, bName: string): AmbiguityVerdict {
  const a = tokens(aName);
  const b = tokens(bName);
  if (!a.length || !b.length) return { ambiguous: false, similarity: 0, reason: "" };

  const similarity = jaccard(a, b);
  const setA = new Set(a);
  const setB = new Set(b);

  const aInB = a.every((token) => setB.has(token));
  const bInA = b.every((token) => setA.has(token));

  if (aInB || bInA) {
    const extra = aInB ? b.filter((t) => !setA.has(t)) : a.filter((t) => !setB.has(t));
    if (extra.length > 0 && extra.length <= 2) {
      return {
        ambiguous: true,
        similarity,
        reason: `Un nombre contiene al otro y solo difiere en: ${extra.join(", ")}`,
      };
    }
  }

  if (similarity >= 0.85) {
    return {
      ambiguous: true,
      similarity,
      reason: `Nombres casi idénticos de la misma marca (coincidencia ${(similarity * 100).toFixed(0)}%)`,
    };
  }

  return { ambiguous: false, similarity, reason: "" };
}
