import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "./env";
import { REMEMBER_COOKIE, REMEMBER_SECONDS, sessionCookieOptions } from "./session-cookies";

export async function createServerSupabaseClient(remember?: boolean) {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnv();
  const persistSession = remember ?? cookieStore.get(REMEMBER_COOKIE)?.value !== "session";

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, sessionCookieOptions(options, persistSession));
          }
          if (remember !== undefined) {
            cookieStore.set(REMEMBER_COOKIE, remember ? "remember" : "session", {
              path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
              ...(remember ? { maxAge: REMEMBER_SECONDS } : {}),
            });
          }
        } catch {
          // Server Components cannot always write cookies. middleware.ts
          // persists refreshed sessions on the response.
        }
      },
    },
  });
}
