"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../../lib/actions";
import { requireAdminActor } from "../../../../lib/supabase/business";
import {
  addShipmentLines,
  cancelShipment,
  confirmShipmentDeparture,
  createShipment,
  getShipmentDetail,
  receiveShipment,
  removeShipmentLine,
  removeShipmentPhotos,
  setShipmentPaid,
  updateShipmentHeader,
  uploadShipmentPhoto,
  type ShipmentLineInput,
} from "../../../../lib/supabase/admin-shipments";

// Thin on purpose: check the session, read the form, delegate. Rules, money,
// notifications and the activity log live in lib/supabase/admin-shipments.ts,
// which takes the actor explicitly (the employee panel can reuse it).

export type ShipmentActionState = ActionState & { id?: string };

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function revalidateShipments(shipmentId?: string | null) {
  revalidatePath("/admin/compras/embarques");
  revalidatePath("/admin/compras/embarques/nuevo");
  if (shipmentId) revalidatePath(`/admin/compras/embarques/${shipmentId}`);
  revalidatePath("/admin/compras/pendientes");
  revalidatePath("/admin/compras");
}

/** Tickets and stock moved: the screens that show them refresh too. */
function revalidateMovedGoods() {
  revalidatePath("/admin/en-camino");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/productos/entrega-inmediata");
  revalidatePath("/admin/inventario");
}

function headerFrom(formData: FormData) {
  return {
    carrier: field(formData, "carrier"),
    trackingNumber: field(formData, "trackingNumber"),
    shippingCost: field(formData, "shippingCost"),
    estimatedArrival: field(formData, "estimatedArrival"),
    notes: field(formData, "notes"),
  };
}

function linesFrom(formData: FormData): ShipmentLineInput[] | null {
  try {
    const parsed = JSON.parse(field(formData, "lines") || "[]") as unknown;
    if (!Array.isArray(parsed)) return null;
    const lines: ShipmentLineInput[] = [];
    for (const entry of parsed as Array<Record<string, unknown>>) {
      if (typeof entry?.assignmentId === "string") lines.push({ assignmentId: entry.assignmentId });
      else if (typeof entry?.purchaseItemId === "string") lines.push({ purchaseItemId: entry.purchaseItemId, quantity: String(entry.quantity ?? "") });
      else return null;
    }
    return lines;
  } catch {
    return null;
  }
}

export async function createShipmentAction(_state: ShipmentActionState, formData: FormData): Promise<ShipmentActionState> {
  try {
    const actor = await requireAdminActor();
    const lines = linesFrom(formData);
    if (!lines) return failure("La selección de artículos no es válida. Recarga e inténtalo de nuevo.");
    const shipmentId = field(formData, "shipmentId");
    if (shipmentId) {
      const result = await addShipmentLines({ actorId: actor.id, shipmentId, lines });
      if (!result.ok) return failure(result.error);
      revalidateShipments(shipmentId);
      return { ...ok(`Se agregaron ${result.linesAdded} línea(s) al embarque ${result.shipmentNumber}.`), id: shipmentId };
    }
    const result = await createShipment({ actorId: actor.id, ...headerFrom(formData), lines });
    if (!result.ok) return failure(result.error);
    revalidateShipments(result.id);
    return { ...ok(`Embarque ${result.shipmentNumber} creado en preparación.`), id: result.id };
  } catch (error) {
    return failure(describeError(error, "No fue posible guardar el embarque."));
  }
}

export async function updateShipmentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const shipmentId = field(formData, "shipmentId");
    const result = await updateShipmentHeader({ actorId: actor.id, shipmentId, ...headerFrom(formData) });
    if (!result.ok) return failure(result.error);
    revalidateShipments(shipmentId);
    return ok("Datos del embarque guardados.");
  } catch (error) {
    return failure(describeError(error, "No fue posible guardar el embarque."));
  }
}

export async function removeShipmentLineAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const result = await removeShipmentLine({ actorId: actor.id, lineId: field(formData, "lineId") });
    if (!result.ok) return failure(result.error);
    revalidateShipments(result.shipmentId);
    return ok("Línea quitada del embarque.");
  } catch (error) {
    return failure(describeError(error, "No fue posible quitar la línea."));
  }
}

export async function confirmDepartureAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const shipmentId = field(formData, "shipmentId");
    const result = await confirmShipmentDeparture({ actorId: actor.id, shipmentId });
    if (!result.ok) return failure(result.error);
    revalidateShipments(shipmentId);
    revalidateMovedGoods();
    return ok(
      `Salida confirmada: ${result.pieces} pieza(s) en camino.${result.ticketsMoved ? ` ${result.ticketsMoved} ticket(s) pasaron a "En camino" y se avisó a las clientas.` : ""}`,
    );
  } catch (error) {
    return failure(describeError(error, "No fue posible confirmar la salida."));
  }
}

export async function cancelShipmentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const shipmentId = field(formData, "shipmentId");
    const result = await cancelShipment({ actorId: actor.id, shipmentId, reason: field(formData, "reason") });
    if (!result.ok) return failure(result.error);
    revalidateShipments(shipmentId);
    return ok(`Embarque ${result.shipmentNumber} cancelado. Sus artículos vuelven a estar pendientes de envío.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible cancelar el embarque."));
  }
}

export async function setShipmentPaidAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const shipmentId = field(formData, "shipmentId");
    const paid = field(formData, "paid") === "true";
    const result = await setShipmentPaid({ actorId: actor.id, shipmentId, paid, paidOn: field(formData, "paidOn") });
    if (!result.ok) return failure(result.error);
    revalidateShipments(shipmentId);
    return ok(paid ? "Envío marcado como pagado." : "Envío marcado como no pagado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible guardar el pago del envío."));
  }
}

function receptionSummary(result: Awaited<ReturnType<typeof receiveShipment>>) {
  if (!result.ok) return "";
  const parts = [`Recepción registrada (${result.good} buena(s), ${result.damaged} dañada(s), ${result.missing} faltante(s)).`];
  if (result.readyTickets.length) parts.push(`Listos para entrega: ${result.readyTickets.join(", ")}.`);
  if (result.incidentTickets.length) parts.push(`Con incidencia (se quedan en "Recibido en La Paz"): ${result.incidentTickets.join(", ")}.`);
  const created = result.products.filter((product) => product.created).length;
  if (result.products.length) {
    parts.push(
      `${result.products.reduce((sum, product) => sum + product.quantity, 0)} pieza(s) libres entraron a Productos entrega inmediata${created ? ` (${created} producto(s) nuevo(s), ocultos y a $0: ponles precio)` : ""}.`,
    );
  }
  parts.push(result.status === "RECEIVED" ? "El embarque quedó recibido completo." : `Quedan ${result.pendingLines} línea(s) con piezas pendientes.`);
  return parts.join(" ");
}

/**
 * One line of the reception (mobile-first: one line, one optional photo per
 * submit — the photo was compressed in the browser so the request stays under
 * the 1 MB server-action limit; more photos = another submit with only the photo).
 */
export async function receiveLineAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  let uploaded: string | null = null;
  try {
    const actor = await requireAdminActor();
    const shipmentId = field(formData, "shipmentId");
    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      const upload = await uploadShipmentPhoto(shipmentId, photo);
      if (!upload.ok) return failure(upload.error);
      uploaded = upload.key;
    }
    const result = await receiveShipment({
      actorId: actor.id,
      shipmentId,
      lines: [
        {
          lineId: field(formData, "lineId"),
          good: field(formData, "good"),
          damaged: field(formData, "damaged"),
          missing: field(formData, "missing"),
          notes: field(formData, "notes"),
          photoKeys: uploaded ? [uploaded] : [],
        },
      ],
    });
    if (!result.ok) {
      if (uploaded) await removeShipmentPhotos([uploaded]);
      return failure(result.error);
    }
    revalidateShipments(shipmentId);
    revalidateMovedGoods();
    return ok(receptionSummary(result));
  } catch (error) {
    if (uploaded) await removeShipmentPhotos([uploaded]);
    return failure(describeError(error, "No fue posible registrar la recepción."));
  }
}

/** "Todo llegó bien": every pending unit of every line as good, in one session. */
export async function receiveAllGoodAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const shipmentId = field(formData, "shipmentId");
    const detail = await getShipmentDetail(shipmentId);
    if (!detail) return failure("Embarque no encontrado.");
    const lines = detail.lines.filter((line) => line.status === "ACTIVE" && line.pending > 0).map((line) => ({ lineId: line.id, good: String(line.pending) }));
    if (!lines.length) return failure("Este embarque no tiene piezas pendientes.");
    const result = await receiveShipment({ actorId: actor.id, shipmentId, lines });
    if (!result.ok) return failure(result.error);
    revalidateShipments(shipmentId);
    revalidateMovedGoods();
    return ok(receptionSummary(result));
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar la recepción."));
  }
}
