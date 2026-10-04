"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { parseQuantity } from "../../../lib/format";
import {
  MANUAL_MOVEMENT_TYPES,
  recordManualMovement,
  type ManualMovementType,
} from "../../../lib/supabase/admin-catalog";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";

function revalidate() {
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/vender");
}

/**
 * RECEIPT / MANUAL_ADJUSTMENT from the Inventario dialog. The ledger write and
 * its guards live in recordManualMovement (lib/supabase/admin-catalog.ts), which
 * the quick stock edit in the Productos lists shares.
 */
export async function registerInventoryMovementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const variantId = String(formData.get("variantId") ?? "");
    if (!variantId) return failure("Variante no encontrada.");

    const movementType = String(formData.get("movementType") ?? "RECEIPT") as ManualMovementType;
    if (!MANUAL_MOVEMENT_TYPES.includes(movementType)) return failure("Tipo de movimiento no válido.");

    const rawQuantity = parseQuantity(formData.get("quantity"));
    if (rawQuantity === null || rawQuantity === 0) return failure("Escribe una cantidad distinta de cero.");
    if (movementType === "RECEIPT" && rawQuantity < 0) return failure("Una entrada debe ser una cantidad positiva.");

    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return failure("Escribe un motivo para este movimiento.");

    const db = adminDb();
    const { data: variant, error: variantError } = await db
      .from("product_variants")
      .select("id, name, is_active, products(name)")
      .eq("id", variantId)
      .maybeSingle();
    if (variantError) return failure(describeError(new Error(variantError.message), "No fue posible leer la variante."));
    if (!variant) return failure("Variante no encontrada.");

    const movement = await recordManualMovement({
      variantId,
      movementType,
      quantityDelta: rawQuantity,
      reason,
      adminId: actor.id,
    });
    if (!movement.ok) return failure(movement.error);

    await logActivity({
      adminUserId: actor.id,
      action: movementType === "RECEIPT" ? "INVENTORY_RECEIPT" : "INVENTORY_ADJUSTMENT",
      entityType: "inventory_movements",
      entityId: variantId,
      newData: { quantityDelta: rawQuantity, reason },
    });
    revalidate();
    return ok(
      movementType === "RECEIPT"
        ? `Entrada registrada: +${rawQuantity}.`
        : `Ajuste registrado: ${rawQuantity > 0 ? "+" : ""}${rawQuantity}.`,
    );
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar el movimiento."));
  }
}
