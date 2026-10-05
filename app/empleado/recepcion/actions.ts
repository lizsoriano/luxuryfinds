"use server";
import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { requireStaffActor } from "../../../lib/supabase/business";
import { getStaffShipment } from "../../../lib/supabase/staff-shipments";
import { receiveShipment } from "../../../lib/supabase/admin-shipments";

export async function receiveStaffLineAction(_state: ActionState, data: FormData): Promise<ActionState> {
  try {
    const actor = await requireStaffActor();
    if (data.get("received") !== "yes") return failure("Marca el producto para confirmar que llegó.");
    const shipmentId = String(data.get("shipmentId") ?? "");
    const lineId = String(data.get("lineId") ?? "");
    const detail = await getStaffShipment(shipmentId);
    const line = detail?.lines.find((entry) => entry.id === lineId);
    if (!detail || !line) return failure("El producto no pertenece a este embarque. Recarga la página.");
    const pending = Number(line.expected_quantity) - Number(line.received_good_quantity) - Number(line.received_damaged_quantity) - Number(line.missing_quantity);
    if (pending <= 0) return ok("La recepción de este producto ya estaba registrada.");
    if (!["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(detail.shipment.status)) return failure("El embarque no está disponible para recepción. Recarga la página.");
    const result = await receiveShipment({ actorId: actor.id, shipmentId, lines: [{ lineId, good: String(pending), damaged: "0", missing: "0", notes: "Recepción confirmada por empleado", photoKeys: [] }] });
    if (!result.ok) return failure(result.error);
    for (const path of ["/empleado/recepcion", `/empleado/recepcion/${shipmentId}`, "/empleado/inventario", "/empleado/entregas", "/admin/compras/embarques", `/admin/compras/embarques/${shipmentId}`, "/admin/inventario", "/admin/productos/entrega-inmediata", "/admin/agenda", "/admin/en-camino", "/admin/pedidos", "/admin/apartados", "/admin/proximamente", "/proximamente", "/cuenta"]) revalidatePath(path);
    return ok("Producto recibido.");
  } catch (error) { return failure(error instanceof Error ? error.message : "No se pudo confirmar la recepción."); }
}
