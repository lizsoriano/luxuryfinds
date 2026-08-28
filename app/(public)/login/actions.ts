"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export type LoginState = { error: string | null };

function safeReturnPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/cuenta";
  }
  return value;
}

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) return { error: "Completa todos los campos." };

  try {
    const supabase = await createServerSupabaseClient();
    const credentials = identifier.includes("@")
      ? { email: identifier, password }
      : { phone: identifier.replace(/[\s()-]/g, ""), password };
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) return { error: "Los datos de acceso no son correctos." };
  } catch {
    return { error: "No fue posible iniciar sesión. Intenta de nuevo." };
  }

  redirect(safeReturnPath(formData.get("next")));
}
