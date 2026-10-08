"use server";

import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";
import { isActiveEmployeeAccount } from "../../../lib/supabase/auth";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { staffLandingPath } from "../../../lib/supabase/staff-roles";

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

  let employee = false;
  try {
    const supabase = await createServerSupabaseClient();
    const credentials = { email: identifier, password };
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error) return { error: "Los datos de acceso no son correctos." };
    // Staff land on their own panel; the owner and clientas keep the usual
    // destination. (/admin refuses an employee on its own anyway.)
    if (data.user) employee = await isActiveEmployeeAccount(data.user);
  } catch {
    return { error: "No fue posible iniciar sesión. Intenta de nuevo." };
  }

  if (employee) redirect(staffLandingPath(formData.get("next")));
  redirect(safeReturnPath(formData.get("next")));
}

// The phone identifies the profile; Auth checks the submitted password using
// its existing email identity. This also works when the Phone provider is off.
export async function phoneLoginAction(
  _previousState: PhoneLoginState,
  formData: FormData,
): Promise<PhoneLoginState> {
  const phone = normalizePhone(formData.get("phone"));
  const password = String(formData.get("password") ?? "");
  if (!phone || !password) return { error: "Ingresa tu celular y contraseña." };
  const invalid = { error: "El celular o la contraseña no son correctos." };
  try {
    const admin = createAdminSupabaseClient();
    const { data: client, error } = await admin.schema("luxury_finds")
      .from("clients").select("id, status").eq("phone", phone).maybeSingle();
    if (error) return { error: "No fue posible iniciar sesión. Intenta de nuevo." };
    if (!client || client.status !== "ACTIVE") return invalid;
    const staff = await admin.schema("luxury_finds").from("admin_users")
      .select("id").eq("id", client.id).maybeSingle();
    if (staff.error) return { error: "No fue posible iniciar sesión. Intenta de nuevo." };
    if (staff.data) return invalid;
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(client.id);
    if (accountError || !account.user?.email) return invalid;
    const supabase = await createServerSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: account.user.email, password });
    if (signInError) return invalid;
  } catch {
    return { error: "No fue posible iniciar sesión. Intenta de nuevo." };
  }
  redirect(safeReturnPath(formData.get("next")));
}
