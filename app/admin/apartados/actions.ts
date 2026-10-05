"use server";
import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { requireAdminActor, adminDb } from "../../../lib/supabase/business";
import { reservationError } from "../../../lib/supabase/incoming-reservations";
import { parseSalePriceToCents } from "../../../lib/supabase/purchase-math";
const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
function refresh() { for (const path of ["/admin/apartados", "/admin/proximamente", "/proximamente", "/admin/cobranza", "/admin/pedidos", "/admin/compras/pendientes", "/cuenta", "/admin/estadisticas", "/admin/inventario", "/empleado/inventario"]) revalidatePath(path); }
export async function createReservationAction(_state: ActionState, data: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const quantity = Number(field(data, "quantity"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return failure("La cantidad debe ser un entero de 1 a 9999.");
    const initial = field(data, "initial"); const amount = initial ? parseSalePriceToCents(initial) : null;
    if (amount && !amount.ok) return failure(amount.error);
    const { data: result, error } = await adminDb().rpc("create_purchase_reservation", { p_item: field(data, "itemId"), p_client: field(data, "clientId"), p_quantity: quantity, p_initial: amount?.ok ? amount.value : null, p_method: field(data, "method"), p_reference: field(data, "reference"), p_actor: actor.id, p_request: field(data, "requestId") });
    if (error) return failure(reservationError(error));
    refresh(); return ok(`Apartado registrado${result?.ticket_number ? `: ${result.ticket_number}` : ""}. El anticipo quedó como pago confirmado.`);
  } catch (error) { return failure(error instanceof Error ? error.message : "No se pudo apartar."); }
}
export async function payReservationAction(_state: ActionState, data: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor(); const amount = parseSalePriceToCents(field(data, "amount"));
    if (!amount.ok) return failure(amount.error);
    const { error } = await adminDb().rpc("pay_purchase_reservation", { p_id: field(data, "id"), p_amount: amount.value, p_method: field(data, "method"), p_reference: field(data, "reference"), p_actor: actor.id, p_request: field(data, "requestId") });
    if (error) return failure(reservationError(error));
    refresh(); return ok("Abono registrado. Si liquidó el total, el apartado ya no vence.");
  } catch (error) { return failure(error instanceof Error ? error.message : "No se pudo registrar el abono."); }
}
export async function cancelReservationAction(_state: ActionState, data: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor(); const reason = field(data, "reason");
    if (!reason || reason.length > 1000) return failure("Escribe un motivo de hasta 1000 caracteres.");
    const { data: changed, error } = await adminDb().rpc("cancel_purchase_reservation", { p_id: field(data, "id"), p_reason: reason, p_actor: actor.id });
    if (error) return failure(reservationError(error));
    refresh(); return ok(changed ? "Piezas liberadas. Los pagos se conservan para que decidas cómo resolverlos." : "Este apartado ya estaba cerrado.");
  } catch (error) { return failure(error instanceof Error ? error.message : "No se pudo cancelar el apartado."); }
}
