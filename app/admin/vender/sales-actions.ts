"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";
import { FULFILLMENT_MIGRATION, missingRelation, salesTarget, UUID } from "../../../lib/supabase/sales";
import { SALES_LOCATION_STATUSES } from "../../../lib/sales-location";
import { trackingError } from "../../../lib/supabase/sales-tracking";

function refresh(value: string) { revalidatePath("/admin/vender"); revalidatePath(`/admin/vender/${value}`); }
export async function changeSaleItemLocation(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const value = String(form.get("target") ?? "");
    const target = salesTarget(value);
    const itemId = String(form.get("itemId") ?? "");
    const status = String(form.get("status") ?? "");
    if (!target || target.kind !== "SALE" || !UUID.test(itemId) || ![...SALES_LOCATION_STATUSES, "DELIVERED"].includes(status)) return failure("Estado o producto no válido.");
    const db = adminDb();
    const sale = await db.from("sales").select("id,status").eq("id", target.id).maybeSingle();
    if (sale.error) throw new Error(sale.error.message);
    if (!sale.data || sale.data.status !== "COMPLETED") return failure("Esta venta ya no está activa.");
    const item = await db.from("sale_items").select("id").eq("id", itemId).eq("sale_id", target.id).maybeSingle();
    if (item.error) throw new Error(item.error.message);
    if (!item.data) return failure("El producto no pertenece a esta venta.");
    const previous = await db.from("sale_item_fulfillment").select("logistics_status").eq("id", itemId).maybeSingle();
    if (missingRelation(previous.error)) return failure(`Aplica ${FULFILLMENT_MIGRATION} en Supabase para guardar estados.`);
    if (previous.error) throw new Error(previous.error.message);
    const result = await db.from("sale_item_fulfillment").upsert({ id: itemId, logistics_status: status, updated_at: new Date().toISOString(), updated_by_admin_id: actor.id }, { onConflict: "id" });
    if (result.error) throw new Error(result.error.message);
    await logActivity({ adminUserId: actor.id, action: "SALE_ITEM_FULFILLMENT_UPDATED", entityType: "sales", entityId: target.id, previousData: previous.data ?? { logistics_status: "DELIVERED" }, newData: { sale_item_id: itemId, logistics_status: status } });
    refresh(value); revalidatePath("/cuenta");
    return ok("Estado guardado. El cliente ya puede consultarlo.");
  } catch (error) { return failure(error instanceof Error ? error.message : "No pudimos guardar el estado."); }
}
export async function saveSalesNotes(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const value = String(form.get("target") ?? ""); const target = salesTarget(value);
    if (!target) return failure("Venta no válida.");
    const notes = String(form.get("notes") ?? "").trim();
    if (notes.length > 5000) return failure("Las notas admiten hasta 5,000 caracteres.");
    const column = target.kind === "SALE" ? "notes" : "internal_notes";
    const db = adminDb();
    const previous = await db.from(target.table).select(column).eq("id", target.id).maybeSingle();
    if (previous.error) throw new Error(previous.error.message);
    if (!previous.data) return failure("La venta ya no existe.");
    const result = await db.from(target.table).update({ [column]: notes || null }).eq("id", target.id).select("id").single();
    if (result.error) throw new Error(result.error.message);
    await logActivity({ adminUserId: actor.id, action: "SALES_NOTES_UPDATED", entityType: target.table, entityId: target.id, previousData: previous.data, newData: { [column]: notes || null } });
    refresh(value); return ok("Notas guardadas.");
  } catch (error) { return failure(error instanceof Error ? error.message : "No pudimos guardar las notas."); }
}

export async function changeSalesTracking(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const value = String(form.get("target") ?? ""); const target = salesTarget(value);
    const mode = String(form.get("mode") ?? "");
    if (!target || !["create", "regenerate", "revoke"].includes(mode)) return failure("Acción no válida.");
    const db = adminDb();
    const parent = await db.from(target.table).select("id").eq("id", target.id).maybeSingle();
    if (parent.error) throw new Error(parent.error.message);
    if (!parent.data) return failure("La venta ya no existe.");
    if (mode !== "create") {
      const revoked = await db.from("sale_tracking_links").update({ revoked_at: new Date().toISOString(), revoked_by_admin_id: actor.id }).eq(target.column, target.id).is("revoked_at", null);
      if (revoked.error) return failure(trackingError(revoked.error));
      await logActivity({ adminUserId: actor.id, action: "SALES_TRACKING_REVOKED", entityType: target.table, entityId: target.id });
      refresh(value);
    }
    if (mode !== "revoke") {
      const created = await db.from("sale_tracking_links").insert({ token: randomBytes(32).toString("base64url"), [target.column]: target.id, created_by_admin_id: actor.id });
      if (created.error) return failure(created.error.code === "23505" ? "Ya existe un enlace activo. Actualiza esta página." : trackingError(created.error));
      await logActivity({ adminUserId: actor.id, action: "SALES_TRACKING_CREATED", entityType: target.table, entityId: target.id });
    }
    refresh(value); return ok(mode === "revoke" ? "Enlace desactivado." : "Enlace de seguimiento listo.");
  } catch (error) { return failure(error instanceof Error ? error.message : "No pudimos actualizar el seguimiento."); }
}
