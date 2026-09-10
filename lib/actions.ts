// Shared server-action result shape. Kept free of Supabase imports so client
// components (useActionState) can import it without pulling the SDK into the bundle.

export type ActionState = { error: string | null; success: string | null };

export const emptyActionState: ActionState = { error: null, success: null };

export function failure(message: string): ActionState {
  return { error: message, success: null };
}

export function ok(message: string): ActionState {
  return { error: null, success: message };
}

/** Turns a thrown Supabase/Postgres error into something the admin can act on. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    const message = error.message;
    if (
      message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("Could not find the")
    ) {
      return "Falta aplicar database/migrations/002_business_management.sql en el editor SQL de Supabase.";
    }
    if (message.includes("duplicate key")) return "Ya existe un registro con esos datos.";
    if (message.includes("permission denied")) return "La base de datos rechazó la operación por permisos.";
    return message;
  }
  return fallback;
}
