/**
 * Roles of `admin_users` (database/migrations/012_employee_roles.sql):
 *   OWNER     the whole panel (/admin)
 *   EMPLOYEE  only the staff panel (/empleado)
 *
 * Kept free of any Supabase import so server code, client components and the
 * verification scripts can share the exact same rule.
 */

export type StaffRole = "OWNER" | "EMPLOYEE";

export const EMPLOYEE_ROLES_MIGRATION_FILE = "database/migrations/012_employee_roles.sql";

export const EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE = `Los accesos de empleado todavía no están activos: falta aplicar ${EMPLOYEE_ROLES_MIGRATION_FILE} en el editor SQL de Supabase.`;

/**
 * Second, independent marker of an employee account, written on the auth user
 * by the service key when the owner creates it (a browser can never set
 * app_metadata). It keeps an employee out of /admin even if the `role` column
 * were ever missing or dropped.
 */
export const APP_METADATA_ROLE_KEY = "lf_role";

/** PostgREST: 42703 "column admin_users.role does not exist" / PGRST204 schema cache. */
export function isMissingRoleColumn(message: string | null | undefined) {
  if (!message) return false;
  // Deliberately narrow: an unrelated 'role "x" does not exist' must not read
  // as "migration missing" (that path treats admins as owners).
  if (/column admin_users\.role does not exist/.test(message)) return true;
  return /Could not find the 'role' column of 'admin_users'/.test(message);
}

/**
 * The effective role of an ACTIVE admin_users row, failing closed:
 *  - the column exists: OWNER only when it says OWNER and the auth user is not
 *    marked as an employee; EMPLOYEE when it says EMPLOYEE; anything else -> null.
 *  - the column does not exist yet (012 not applied): every admin is the owner,
 *    exactly as before roles existed — except an auth user marked EMPLOYEE.
 */
export function resolveStaffRole(input: {
  roleColumnExists: boolean;
  rowRole: unknown;
  appMetadataRole: unknown;
}): StaffRole | null {
  const markedEmployee = input.appMetadataRole === "EMPLOYEE";
  if (!input.roleColumnExists) return markedEmployee ? "EMPLOYEE" : "OWNER";
  if (input.rowRole === "EMPLOYEE") return "EMPLOYEE";
  if (input.rowRole === "OWNER") return markedEmployee ? "EMPLOYEE" : "OWNER";
  return null;
}

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: "Propietaria",
  EMPLOYEE: "Empleado",
};

/** Only these paths may follow a staff login (the `next` parameter). */
export function staffLandingPath(next: unknown) {
  if (typeof next === "string" && (next === "/empleado" || next.startsWith("/empleado/")) && !next.startsWith("//")) {
    return next;
  }
  return "/empleado";
}
