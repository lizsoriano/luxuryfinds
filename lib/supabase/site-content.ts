import { adminDb } from "./business";
import { DEFAULT_SITE_CONTENT, normalizeSiteContent } from "../site-content";
export async function readSiteContent(strict = false) {
  try {
    const { data, error } = await adminDb().from("app_settings").select("value").eq("key", "public_site_content").maybeSingle();
    if (error) throw new Error(error.message);
    return normalizeSiteContent(data?.value);
  } catch (error) {
    if (strict) throw error;
    return { ...DEFAULT_SITE_CONTENT, sections: [...DEFAULT_SITE_CONTENT.sections] };
  }
}
