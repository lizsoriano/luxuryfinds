import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "./admin";
import { hasPublicSupabaseEnv } from "./env";
import { createServerSupabaseClient } from "./server";

export type ClientProfile = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  payment_plans_allowed: boolean;
  credit_balance_cents: number;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
};

export async function getAuthenticatedUser() {
  if (!hasPublicSupabaseEnv()) return { supabase: null, user: null };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : data.user };
}

export async function requireAuthenticatedUser(returnTo: string) {
  const context = await getAuthenticatedUser();
  if (!context.user || !context.supabase) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return { supabase: context.supabase, user: context.user };
}

export async function getClientProfile() {
  const { supabase, user } = await requireAuthenticatedUser("/cuenta");
  const { data, error } = await supabase
    .schema("luxury_finds")
    .from("clients")
    .select("id, first_name, last_name, email, phone, payment_plans_allowed, credit_balance_cents, status")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`No fue posible cargar el perfil: ${error.message}`);
  return { supabase, user, profile: data as ClientProfile | null };
}

export async function getAdminSession() {
  const { user } = await getAuthenticatedUser();
  if (!user) return { kind: "unauthenticated" as const };

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("luxury_finds")
    .from("admin_users")
    .select("id, username, display_name, status")
    .eq("id", user.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (error) throw new Error(`No fue posible validar al administrador: ${error.message}`);
  if (!data) return { kind: "unauthorized" as const, user };
  return { kind: "authorized" as const, user, admin: data };
}
