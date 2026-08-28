import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "./env";

export function createAdminSupabaseClient() {
  if (typeof window !== "undefined") {
    throw new Error("El cliente administrativo solo puede utilizarse en servidor.");
  }

  const { url } = getPublicSupabaseEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Falta SUPABASE_SECRET_KEY en las variables de entorno del servidor.");
  }
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
