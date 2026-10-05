"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { createEmployee, resetEmployeePassword, setEmployeeStatus } from "../../../lib/supabase/admin-employees";
import { requireAdminActor } from "../../../lib/supabase/business";

// Owner-only (requireAdminActor refuses employees). The password is typed by
// the owner in her own form and only travels to Supabase Auth; it is never
// stored, logged or echoed back.

function revalidate(id?: string) {
  revalidatePath("/admin/empleados");
  if (id) revalidatePath(`/admin/empleados/${id}`);
}

export async function createEmployeeAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const result = await createEmployee({
      ownerId: actor.id,
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    });
    if (!result.ok) return failure(result.error);
    revalidate(result.employeeId);
    return ok(result.message);
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar al empleado."));
  }
}

export async function setEmployeeStatusAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const employeeId = String(formData.get("id") ?? "");
    const active = String(formData.get("active") ?? "") === "true";
    const result = await setEmployeeStatus({ ownerId: actor.id, employeeId, active });
    if (!result.ok) return failure(result.error);
    revalidate(employeeId);
    return ok(result.message);
  } catch (error) {
    return failure(describeError(error, "No fue posible cambiar el estado."));
  }
}

export async function resetEmployeePasswordAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const employeeId = String(formData.get("id") ?? "");
    const result = await resetEmployeePassword({ ownerId: actor.id, employeeId, password: String(formData.get("password") ?? "") });
    if (!result.ok) return failure(result.error);
    revalidate(employeeId);
    return ok(result.message);
  } catch (error) {
    return failure(describeError(error, "No fue posible cambiar la contraseña."));
  }
}
