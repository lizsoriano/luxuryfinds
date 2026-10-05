import { readSiteContent } from "../../../lib/supabase/site-content";
import { SiteForm } from "./SiteForm";
export const dynamic = "force-dynamic";
export default async function Page() {
  let content;
  try { content = await readSiteContent(true); }
  catch (error) { return <main className="admin-content"><h1>Sitio Web</h1><p className="form-message form-error" role="alert">No se pudo cargar la configuración: {error instanceof Error ? error.message : "error desconocido"}</p></main>; }
  return <main className="admin-content"><h1>Sitio Web</h1><p className="admin-hint">Edita la portada, los avisos, el orden de las secciones y los metadatos públicos.</p><SiteForm content={content} /></main>;
}
