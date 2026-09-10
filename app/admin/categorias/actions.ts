"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { slugify } from "../../../lib/format";
import { ensureUniqueSlug } from "../../../lib/supabase/admin-catalog";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";

function revalidate() {
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/inventario");
}

export async function createCategoryAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return failure("El nombre de la categoría es obligatorio.");
    if (name.length > 80) return failure("El nombre no puede exceder 80 caracteres.");

    const slug = await ensureUniqueSlug("categories", slugify(name));
    const { data, error } = await adminDb()
      .from("categories")
      .insert({ name, slug, is_active: true })
      .select("id")
      .single();
    if (error) return failure(describeError(new Error(error.message), "No fue posible crear la categoría."));

    await logActivity({
      adminUserId: actor.id,
      action: "CATEGORY_CREATED",
      entityType: "categories",
      entityId: data.id as string,
      newData: { name, slug },
    });
    revalidate();
    return ok(`Categoría "${name}" creada.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible crear la categoría."));
  }
}

export async function updateCategoryAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!id) return failure("Categoría no encontrada.");
    if (!name) return failure("El nombre de la categoría es obligatorio.");

    const db = adminDb();
    const { data: previous } = await db.from("categories").select("name, slug").eq("id", id).maybeSingle();
    const slug = await ensureUniqueSlug("categories", slugify(name), id);

    const { error } = await db.from("categories").update({ name, slug }).eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible actualizar la categoría."));

    await logActivity({
      adminUserId: actor.id,
      action: "CATEGORY_UPDATED",
      entityType: "categories",
      entityId: id,
      previousData: previous ?? null,
      newData: { name, slug },
    });
    revalidate();
    return ok("Categoría actualizada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible actualizar la categoría."));
  }
}

/** Soft-delete: `is_active=false` is already the archiving pattern in the schema. */
export async function setCategoryActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const active = String(formData.get("active") ?? "") === "true";
    if (!id) return failure("Categoría no encontrada.");

    const { error } = await adminDb().from("categories").update({ is_active: active }).eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible cambiar la categoría."));

    await logActivity({
      adminUserId: actor.id,
      action: active ? "CATEGORY_RESTORED" : "CATEGORY_ARCHIVED",
      entityType: "categories",
      entityId: id,
      newData: { is_active: active },
    });
    revalidate();
    return ok(active ? "Categoría restaurada." : "Categoría archivada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible cambiar la categoría."));
  }
}
