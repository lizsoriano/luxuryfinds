import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "./admin";
import { hasPublicSupabaseEnv } from "./env";
import { createServerSupabaseClient } from "./server";
import { APP_METADATA_ROLE_KEY, isMissingRoleColumn, resolveStaffRole, type StaffRole } from "./staff-roles";

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

type AdminRowBase = { id: string; username: string; display_name: string; status: string };

export type StaffAccount = { id: string; username: string; display_name: string; role: StaffRole };

/**
 * Reads the caller's admin_users row (any status) with its role. Before
 * migration 012 the `role` column does not exist: the read is retried without
 * it and `roleColumnExists` is false. Any other error is thrown, never
 * swallowed into "authorized".
 */
async function readAdminRow(userId: string) {
  const table = () => createAdminSupabaseClient().schema("luxury_finds").from("admin_users");
  const withRole = await table().select("id, username, display_name, status, role").eq("id", userId).maybeSingle();
  if (!withRole.error) {
    const row = withRole.data as (AdminRowBase & { role: unknown }) | null;
    return { row, rowRole: row?.role ?? null, roleColumnExists: true };
  }
  if (!isMissingRoleColumn(withRole.error.message)) {
    throw new Error(`No fue posible validar al administrador: ${withRole.error.message}`);
  }
  const legacy = await table().select("id, username, display_name, status").eq("id", userId).maybeSingle();
  if (legacy.error) throw new Error(`No fue posible validar al administrador: ${legacy.error.message}`);
  return { row: legacy.data as AdminRowBase | null, rowRole: null, roleColumnExists: false };
}

function appMetadataRole(user: { app_metadata?: Record<string, unknown> | null }) {
  return user.app_metadata?.[APP_METADATA_ROLE_KEY] ?? null;
}

/**
 * The owner's panel (/admin). Authorized ONLY for an ACTIVE row whose role is
 * OWNER (before migration 012: every active admin, as always — see
 * resolveStaffRole). An employee gets `unauthorized` with `isEmployee`, so every
 * existing check (`kind !== "authorized"`) keeps refusing them, and the layout
 * can send them to /empleado.
 */
export async function getAdminSession() {
  const { user } = await getAuthenticatedUser();
  if (!user) return { kind: "unauthenticated" as const };

  const { row, rowRole, roleColumnExists } = await readAdminRow(user.id);
  if (!row || row.status !== "ACTIVE") return { kind: "unauthorized" as const, user, isEmployee: false };
  const role = resolveStaffRole({ roleColumnExists, rowRole, appMetadataRole: appMetadataRole(user) });
  if (role !== "OWNER") return { kind: "unauthorized" as const, user, isEmployee: role === "EMPLOYEE" };
  const admin: AdminRowBase = { id: row.id, username: row.username, display_name: row.display_name, status: row.status };
  return { kind: "authorized" as const, user, admin };
}

/**
 * The staff panel (/empleado): OWNER or EMPLOYEE, ACTIVE.
 *  - unavailable: migration 012 is missing (no employee can exist yet); the
 *    panel shows a notice naming the file instead of opening.
 *  - inactive:    an employee the owner deactivated.
 */
export async function getStaffSession() {
  const { user } = await getAuthenticatedUser();
  if (!user) return { kind: "unauthenticated" as const };

  const { row, rowRole, roleColumnExists } = await readAdminRow(user.id);
  if (!row) return { kind: "unauthorized" as const, user };
  if (!roleColumnExists) return { kind: "unavailable" as const, user };
  const role = resolveStaffRole({ roleColumnExists, rowRole, appMetadataRole: appMetadataRole(user) });
  if (!role) return { kind: "unauthorized" as const, user };
  if (row.status !== "ACTIVE") return { kind: "inactive" as const, user };
  const staff: StaffAccount = { id: row.id, username: row.username, display_name: row.display_name, role };
  return { kind: "authorized" as const, user, staff };
}

/**
 * Used right after a password sign-in (app/(public)/login/actions.ts) to send an
 * employee to /empleado. Never throws: on any doubt it answers "not an employee"
 * and the normal redirect applies — /admin itself still refuses an employee.
 */
export async function isActiveEmployeeAccount(user: { id: string; app_metadata?: Record<string, unknown> | null }) {
  try {
    const { row, rowRole, roleColumnExists } = await readAdminRow(user.id);
    if (!row || row.status !== "ACTIVE") return false;
    return resolveStaffRole({ roleColumnExists, rowRole, appMetadataRole: appMetadataRole(user) }) === "EMPLOYEE";
  } catch {
    return false;
  }
}
