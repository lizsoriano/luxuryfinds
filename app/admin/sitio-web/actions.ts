"use server";
import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { CATALOG_SECTIONS, HOME_SECTIONS, normalizeSiteContent, safeSiteUrl } from "../../../lib/site-content";
import { adminDb, adminStorage, PRODUCT_IMAGE_BUCKET, logActivity, requireAdminActor } from "../../../lib/supabase/business";
export async function saveSiteContentAction(_state: ActionState, data: FormData): Promise<ActionState> {
  let uploaded: string | null = null;
  try {
    const actor = await requireAdminActor();
    const fields = ["eyebrow", "title", "emphasis", "description", "bannerUrl", "bannerAlt", "bannerHref", "announcement", "seoTitle", "seoDescription", "canonicalOrigin"];
    const value: Record<string, unknown> = {};
    for (const field of fields) {
      const text = String(data.get(field) ?? "").trim();
      if (text.length > (field.includes("Url") ? 2000 : 600)) return failure("Uno de los textos excede el tamaño permitido.");
      value[field] = text;
    }
    if (!value.title || !value.seoTitle || !value.seoDescription || !value.bannerAlt) return failure("Completa el título, la descripción para buscadores y el texto de la imagen.");
    if (!safeSiteUrl(String(value.bannerUrl)) || !safeSiteUrl(String(value.bannerHref), false)) return failure("La imagen debe usar HTTPS o una ruta local, y su enlace una ruta del sitio (por ejemplo /catalogo).");
    try { const url = new URL(String(value.canonicalOrigin)); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(); } catch { return failure("Escribe el dominio completo con https://, sin rutas."); }
    const sections = data.getAll("sections").map(String);
    if (sections.length !== 3 || new Set(sections).size !== 3 || !sections.every((section) => HOME_SECTIONS.includes(section as typeof HOME_SECTIONS[number]))) return failure("Cada sección debe aparecer una sola vez.");
    value.sections = sections;
    const catalogOrder = data.getAll("catalogOrder").map(String);
    if (catalogOrder.length !== CATALOG_SECTIONS.length || new Set(catalogOrder).size !== CATALOG_SECTIONS.length || !catalogOrder.every((section) => CATALOG_SECTIONS.includes(section))) return failure("Cada sección del catálogo debe aparecer una sola vez.");
    value.catalogOrder = catalogOrder;
    const banner = data.get("banner");
    if (banner instanceof File && banner.size) {
      if (banner.type !== "image/jpeg" || banner.size > 850 * 1024) return failure("La portada debe reducirse antes de guardarla.");
      uploaded = `site-banners/${crypto.randomUUID()}.jpg`;
      const storage = adminStorage().from(PRODUCT_IMAGE_BUCKET);
      const upload = await storage.upload(uploaded, banner, { contentType: "image/jpeg", upsert: false });
      if (upload.error) throw new Error(upload.error.message);
      value.bannerUrl = storage.getPublicUrl(uploaded).data.publicUrl;
    }
    const content = normalizeSiteContent(value);
    const { error } = await adminDb().from("app_settings").upsert({ key: "public_site_content", value: content, description: "Contenido y metadatos del sitio público", updated_by_admin_id: actor.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    uploaded = null; // The image is now referenced by saved content; keep it if revalidation fails.
    await logActivity({ adminUserId: actor.id, action: "SITE_CONTENT_UPDATED", entityType: "app_settings", entityId: "public_site_content", newData: content });
    revalidatePath("/", "layout"); revalidatePath("/admin/sitio-web");
    return ok("Sitio guardado. Los cambios ya aparecen en la página pública.");
  } catch (error) {
    if (uploaded) await adminStorage().from(PRODUCT_IMAGE_BUCKET).remove([uploaded]);
    return failure(error instanceof Error ? error.message : "No se pudo guardar el sitio.");
  }
}
