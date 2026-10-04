"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";
import { insertSupplier, readSupplierInput } from "../../../lib/supabase/admin-contacts";

function revalidate() {
  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/compras/nueva");
  revalidatePath("/admin/vender");
  revalidatePath("/admin/balance");
}

export async function createSupplierAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const parsed = readSupplierInput(formData);
    if (!parsed.ok) return failure(parsed.error);
    const values = parsed.values;

    let supplierId: string;
    try {
      supplierId = await insertSupplier(actor.id, values);
    } catch (error) {
      return failure(describeError(error, "No fue posible crear el proveedor."));
    }

    await logActivity({
      adminUserId: actor.id,
      action: "SUPPLIER_CREATED",
      entityType: "suppliers",
      entityId: supplierId,
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
    const parsed = readSupplierInput(formData);
    if (!parsed.ok) return failure(parsed.error);
    const values = parsed.values;

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
