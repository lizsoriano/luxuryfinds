"use server";
import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { requireStaffActor } from "../../../lib/supabase/business";
import { getStaffShipment } from "../../../lib/supabase/staff-shipments";
import { receiveShipment, uploadShipmentPhoto, removeShipmentPhotos } from "../../../lib/supabase/admin-shipments";
export async function receiveStaffLineAction(_state: ActionState, data: FormData): Promise<ActionState> {
  let uploaded: string | null = null;
  try {
    const actor = await requireStaffActor();
    const shipmentId = String(data.get("shipmentId") ?? "");
    const lineId = String(data.get("lineId") ?? "");
    const detail = await getStaffShipment(shipmentId);
    if (!detail || !["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(detail.shipment.status) || !detail.lines.some((line) => line.id === lineId)) return failure("La línea no está disponible para recepción. Recarga la página.");
    const photo = data.get("photo");
    if (photo instanceof File && photo.size) {
      if (photo.size > 850 * 1024) return failure("Reduce la foto antes de enviarla.");
      const result = await uploadShipmentPhoto(shipmentId, photo);
      if (!result.ok) return failure(result.error);
      uploaded = result.key;
    }
    const result = await receiveShipment({ actorId: actor.id, shipmentId, lines: [{ lineId, good: String(data.get("good") ?? "0"), damaged: String(data.get("damaged") ?? "0"), missing: String(data.get("missing") ?? "0"), notes: String(data.get("notes") ?? ""), photoKeys: uploaded ? [uploaded] : [] }] });
    if (!result.ok) { if (uploaded) await removeShipmentPhotos([uploaded]); return failure(result.error); }
    for (const path of ["/empleado/recepcion", `/empleado/recepcion/${shipmentId}`, "/empleado/inventario", "/empleado/entregas", "/admin/compras/embarques", `/admin/compras/embarques/${shipmentId}`, "/admin/inventario", "/admin/productos/entrega-inmediata", "/admin/agenda", "/admin/en-camino", "/admin/pedidos"]) revalidatePath(path);
    return ok(`Recepción registrada: ${result.good} buena(s), ${result.damaged} dañada(s), ${result.missing} faltante(s).${result.incidentTickets.length ? " La dueña revisará las incidencias." : ""}`);
  } catch (error) { if (uploaded) await removeShipmentPhotos([uploaded]); return failure(error instanceof Error ? error.message : "No se pudo registrar la recepción."); }
}
