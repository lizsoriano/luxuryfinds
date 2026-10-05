import { createAdminSupabaseClient } from "./admin";
import { getAdminSession, getStaffSession, type StaffAccount } from "./auth";
import { EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE } from "./staff-roles";

/**
 * Seeded in database/migrations/002_business_management.sql. Multi-business is
 * prepared at the data level (every new table carries business_id) but the panel
 * still operates on this single business; the sidebar's "Agregar otro negocio"
 * says so explicitly instead of pretending to switch.
 */
export const DEFAULT_BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
export const DEFAULT_BUSINESS_NAME = "Luxury Finds";

/**
 * The live database serves catalogue images from this bucket (see the public
 * reader in lib/supabase/catalog.ts). Admin uploads must target the same one or
 * the public catalogue would render broken images.
 */
export const PRODUCT_IMAGE_BUCKET = "oskinmx-catalog";
export const EXPENSE_RECEIPT_BUCKET = "expense-receipts";

export const MAX_PRODUCT_IMAGES = 3;

export type AdminActor = { id: string; display_name: string; username: string };

/**
 * Throws when the caller is not an active OWNER (getAdminSession refuses
 * employees). Every /admin server action goes through here, so the owner's
 * panel stays owner-only with this single check. Server actions catch this.
 */
export async function requireAdminActor(): Promise<AdminActor> {
  const session = await getAdminSession();
  if (session.kind !== "authorized") {
    throw new Error("Tu sesión administrativa no es válida. Vuelve a iniciar sesión.");
  }
  return session.admin as AdminActor;
}

export type StaffActor = StaffAccount;

/**
 * Throws unless the caller is an active OWNER or EMPLOYEE and migration 012 is
 * applied. ONLY for the staff panel (/empleado) — never use it to guard
 * anything of the owner's panel.
 */
export async function requireStaffActor(): Promise<StaffActor> {
  const session = await getStaffSession();
  if (session.kind === "unavailable") throw new Error(EMPLOYEE_ROLES_UNAVAILABLE_MESSAGE);
  if (session.kind !== "authorized") {
    throw new Error("Tu sesión de empleado no es válida. Vuelve a iniciar sesión.");
  }
  return session.staff;
}

export function adminDb() {
  return createAdminSupabaseClient().schema("luxury_finds");
}

export function adminStorage() {
  return createAdminSupabaseClient().storage;
}

/** Reuses the existing activity_logs audit table instead of a parallel log. */
export async function logActivity(input: {
  adminUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousData?: unknown;
  newData?: unknown;
}) {
  try {
    await adminDb().from("activity_logs").insert({
      admin_user_id: input.adminUserId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      previous_data: input.previousData ?? null,
      new_data: input.newData ?? null,
    });
  } catch {
    // Auditing must never block the operation the user asked for.
  }
}

export { emptyActionState, failure, ok, describeError } from "../actions";
export type { ActionState } from "../actions";
