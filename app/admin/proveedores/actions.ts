"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { DEFAULT_BUSINESS_ID, adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";

function revalidate() {
  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/vender");
  revalidatePath("/admin/balance");
}

function readForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    company: String(formData.get("company") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim().toLowerCase() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createSupplierAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const values = readForm(formData);
    if (!values.name) return failure("El nombre del proveedor es obligatorio.");
    if (values.email && !values.email.includes("@")) return failure("El correo no es válido.");

    const { data, error } = await adminDb()
      .from("suppliers")
      .insert({ ...values, business_id: DEFAULT_BUSINESS_ID, is_active: true, created_by_admin_id: actor.id })
      .select("id")
      .single();
    if (error) return failure(describeError(new Error(error.message), "No fue posible crear el proveedor."));

    await logActivity({
      adminUserId: actor.id,
      action: "SUPPLIER_CREATED",
      entityType: "suppliers",
      entityId: data.id as string,
      newData: values,
    });
    revalidate();
    return ok(`Proveedor "${values.name}" creado.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible crear el proveedor."));
  }
}

export async function updateSupplierAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    if (!id) return failure("Proveedor no encontrado.");
    const values = readForm(formData);
    if (!values.name) return failure("El nombre del proveedor es obligatorio.");
    if (values.email && !values.email.includes("@")) return failure("El correo no es válido.");

    const { error } = await adminDb()
      .from("suppliers")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible actualizar el proveedor."));

    await logActivity({
      adminUserId: actor.id,
      action: "SUPPLIER_UPDATED",
      entityType: "suppliers",
      entityId: id,
      newData: values,
    });
    revalidate();
    return ok("Proveedor actualizado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible actualizar el proveedor."));
  }
}

export async function setSupplierActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const active = String(formData.get("active") ?? "") === "true";
    if (!id) return failure("Proveedor no encontrado.");

    const { error } = await adminDb()
      .from("suppliers")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible cambiar el proveedor."));

    await logActivity({
      adminUserId: actor.id,
      action: active ? "SUPPLIER_RESTORED" : "SUPPLIER_ARCHIVED",
      entityType: "suppliers",
      entityId: id,
      newData: { is_active: active },
    });
    revalidate();
    return ok(active ? "Proveedor restaurado." : "Proveedor archivado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible cambiar el proveedor."));
  }
}
