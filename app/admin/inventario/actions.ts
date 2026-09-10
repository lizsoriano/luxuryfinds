"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { parseQuantity } from "../../../lib/format";
import { getStockFor } from "../../../lib/supabase/admin-catalog";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";

function revalidate() {
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/vender");
}

const MOVEMENT_TYPES = ["RECEIPT", "MANUAL_ADJUSTMENT"] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * The only two movement types schema.sql allows outside of a sale/pedido/
 * delivery: RECEIPT (new stock coming in, always positive) and
 * MANUAL_ADJUSTMENT (a correction, either direction, e.g. shrinkage/breakage
 * found on a physical count). Both write straight into inventory_movements —
 * the same ledger Vender and Pedidos already use — so variant_stock and every
 * KPI derived from it stay correct with no separate stock field to keep in sync.
 */
export async function registerInventoryMovementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const variantId = String(formData.get("variantId") ?? "");
    if (!variantId) return failure("Variante no encontrada.");

    const movementType = String(formData.get("movementType") ?? "RECEIPT") as MovementType;
    if (!MOVEMENT_TYPES.includes(movementType)) return failure("Tipo de movimiento no válido.");

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

    if (rawQuantity < 0) {
      const stock = await getStockFor([variantId]);
      const available = stock.get(variantId) ?? 0;
      if (available + rawQuantity < 0) {
        return failure(`El ajuste dejaría el stock en negativo: disponible ${available}, ajuste ${rawQuantity}.`);
      }
    }

    const { error } = await db.from("inventory_movements").insert({
      variant_id: variantId,
      movement_type: movementType,
      quantity_delta: rawQuantity,
      reason,
      created_by_admin_id: actor.id,
    });
    if (error) return failure(describeError(new Error(error.message), "No fue posible registrar el movimiento."));

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
