"use server";

import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export type LoginState = { error: string | null };
export type PhoneLoginState = { error: string | null };

function safeReturnPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/cuenta";
  }
  return value;
}

function normalizePhone(value: FormDataEntryValue | null) {
  return String(value ?? "").replace(/[\s()-]/g, "").trim();
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

/**
 * Passwordless access for clientas: the celular alone is enough, no password
 * and no SMS code. We satisfy Supabase Auth (which only signs in with a
 * password or an OTP it sends itself) by minting a one-time random password
 * server-side, swapping it onto the account, and signing in with it in the
 * same request - the client never sees it. This intentionally trades
 * confidentiality for the low-friction access the owner asked for, so it is
 * scoped tightly: only ACTIVE clients, and never an admin_users account, even
 * though admins authenticate through the separate email+password form above.
 */
export async function phoneLoginAction(
  _previousState: PhoneLoginState,
  formData: FormData,
): Promise<PhoneLoginState> {
  const phone = normalizePhone(formData.get("phone"));
  if (!phone) return { error: "Ingresa tu celular." };

  try {
    const admin = createAdminSupabaseClient();
    const { data: client, error: clientError } = await admin
      .schema("luxury_finds")
      .from("clients")
      .select("id, status")
      .eq("phone", phone)
      .maybeSingle();
    if (clientError) return { error: "No fue posible validar tu celular. Intenta de nuevo." };
    if (!client || client.status !== "ACTIVE") {
      return { error: "No encontramos una cuenta activa con ese celular." };
    }

    const { data: adminRow } = await admin
      .schema("luxury_finds")
      .from("admin_users")
      .select("id")
      .eq("id", client.id)
      .maybeSingle();
    if (adminRow) return { error: "No encontramos una cuenta activa con ese celular." };

    const tempPassword = crypto.randomUUID();
    const { error: updateError } = await admin.auth.admin.updateUserById(client.id, { password: tempPassword });
    if (updateError) return { error: "No fue posible iniciar sesión. Intenta de nuevo." };

    const supabase = await createServerSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ phone, password: tempPassword });
    if (signInError) return { error: "No fue posible iniciar sesión. Intenta de nuevo." };
  } catch {
    return { error: "No fue posible iniciar sesión. Intenta de nuevo." };
  }

  redirect(safeReturnPath(formData.get("next")));
}
