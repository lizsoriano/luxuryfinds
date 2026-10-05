export const HOME_SECTIONS = ["banner", "texto", "destacados"] as const;
export type HomeSection = typeof HOME_SECTIONS[number];
export const CATALOG_SECTIONS = ["Todo", "Entrega inmediata", "Por pedido", "Sephora Favorites", "Perfumes", "Blushes", "Labiales", "Bases", "Correctores"];
export const DEFAULT_SITE_CONTENT = {
  eyebrow: "TU PRÓXIMO FAVORITO", title: "Encuentra algo", emphasis: "que te encante.",
  description: "Productos especiales de moda y belleza, compras por pedido y piezas listas para entrega inmediata en La Paz.",
  bannerUrl: "/images/banner-inicio.webp", bannerAlt: "Luxury Finds", bannerHref: "/catalogo", announcement: "",
  seoTitle: "Luxury Finds | Belleza, moda y hallazgos especiales",
  seoDescription: "Productos especiales, compras por pedido y piezas disponibles para entrega inmediata.",
  canonicalOrigin: "https://www.luxuryfinds.com.mx", sections: [...HOME_SECTIONS] as HomeSection[],
  catalogOrder: [...CATALOG_SECTIONS],
};
export type SiteContent = typeof DEFAULT_SITE_CONTENT;
export function safeSiteUrl(value: string, external = true) {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  if (!external) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
export function normalizeSiteContent(value: unknown): SiteContent {
  const result = { ...DEFAULT_SITE_CONTENT, sections: [...HOME_SECTIONS] };
  if (!value || typeof value !== "object") return result;
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SITE_CONTENT) as Array<keyof SiteContent>) {
    if (key !== "sections" && key !== "catalogOrder" && typeof row[key] === "string") result[key] = row[key] as string;
  }
  if (!safeSiteUrl(result.bannerUrl)) result.bannerUrl = DEFAULT_SITE_CONTENT.bannerUrl;
  if (!safeSiteUrl(result.bannerHref, false)) result.bannerHref = DEFAULT_SITE_CONTENT.bannerHref;
  try { const origin = new URL(result.canonicalOrigin); if (origin.protocol !== "https:") throw new Error(); result.canonicalOrigin = origin.origin; } catch { result.canonicalOrigin = DEFAULT_SITE_CONTENT.canonicalOrigin; }
  if (Array.isArray(row.sections) && row.sections.length === HOME_SECTIONS.length && new Set(row.sections).size === HOME_SECTIONS.length && row.sections.every((section) => HOME_SECTIONS.includes(section))) result.sections = row.sections;
  if (Array.isArray(row.catalogOrder) && row.catalogOrder.length === CATALOG_SECTIONS.length && new Set(row.catalogOrder).size === CATALOG_SECTIONS.length && row.catalogOrder.every((section) => CATALOG_SECTIONS.includes(section))) result.catalogOrder = row.catalogOrder;
  return result;
}
