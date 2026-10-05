"use client";
import { useActionState, useState } from "react";
import { emptyActionState } from "../../../lib/actions";
import { type SiteContent, HOME_SECTIONS } from "../../../lib/site-content";
import { saveSiteContentAction } from "./actions";
import { compressPhoto } from "../compras/compress-photo";
const labels: Record<string, string> = { eyebrow: "Texto pequeño sobre el título", title: "Título de portada", emphasis: "Segunda línea del título", description: "Descripción de portada", bannerUrl: "URL de la imagen de portada", bannerAlt: "Descripción de la imagen", bannerHref: "Destino al tocar la portada", announcement: "Aviso en la portada (opcional)", seoTitle: "Título para buscadores", seoDescription: "Descripción para buscadores", canonicalOrigin: "Dominio principal" };
const sectionLabels = { banner: "Imagen de portada", texto: "Texto y botones", destacados: "Productos destacados" };
export function SiteForm({ content }: { content: SiteContent }) {
  const [catalogOrder, setCatalogOrder] = useState(content.catalogOrder);
  const [state, action, pending] = useActionState(async (previous: typeof emptyActionState, data: FormData) => {
    try {
      const photo = data.get("banner");
      if (photo instanceof File && photo.size) data.set("banner", await compressPhoto(photo));
      return await saveSiteContentAction(previous, data);
    } catch (error) { return { success: null, error: error instanceof Error ? error.message : "No se pudo preparar la portada." }; }
  }, emptyActionState);
  return <form action={action} className="admin-panel"><div className="admin-form-grid">
    {Object.entries(labels).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input className="input" name={key} defaultValue={content[key as keyof Omit<SiteContent, "sections" | "catalogOrder">]} maxLength={key === "bannerUrl" ? 2000 : 600} required={key !== "announcement" && key !== "eyebrow" && key !== "emphasis" && key !== "description"} /></label>)}
    <label className="field field-wide"><span>Subir nueva imagen de portada (opcional)</span><input type="file" name="banner" accept="image/jpeg,image/png,image/webp" /><small>Se reduce automáticamente. Si eliges una foto, reemplaza la URL de portada.</small></label>
    <div className="field field-wide"><span>Orden de secciones de inicio</span><div className="admin-form-grid">{content.sections.map((section, index) => <label className="field" key={index}><span>Posición {index + 1}</span><select className="input" name="sections" defaultValue={section}>{HOME_SECTIONS.map((entry) => <option key={entry} value={entry}>{sectionLabels[entry]}</option>)}</select></label>)}</div></div>
    <div className="field field-wide"><span>Orden de las pestañas del catálogo</span><ol className="site-section-order">{catalogOrder.map((section, index) => <li key={section}><input type="hidden" name="catalogOrder" value={section} /><span>{section}</span><button className="button button-secondary button-small" type="button" aria-label={`Subir ${section}`} disabled={index === 0 || pending} onClick={() => setCatalogOrder((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</button><button className="button button-secondary button-small" type="button" aria-label={`Bajar ${section}`} disabled={index === catalogOrder.length - 1 || pending} onClick={() => setCatalogOrder((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}>↓</button></li>)}</ol></div>
    <p className="admin-hint field-wide">El dominio configura las referencias para buscadores. Para conectar un dominio nuevo también se necesita configurarlo en Vercel y en su proveedor DNS.</p>
    {state.error && <p className="form-message form-error field-wide" role="alert">{state.error}</p>}{state.success && <p className="form-message form-success field-wide" role="status">{state.success}</p>}
    <div className="admin-form-actions"><button className="button button-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar sitio"}</button><a className="button button-secondary" href="/" target="_blank" rel="noreferrer">Ver sitio</a></div>
  </div></form>;
}
