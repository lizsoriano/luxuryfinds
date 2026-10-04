"use server";

import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import {
  cancelPurchase,
  confirmPurchase,
  createPurchase,
  deleteItem,
  deleteTicket,
  describePurchaseError,
  registerShopperPayment,
  saveItem,
  saveTicket,
  updatePurchaseHeader,
  voidShopperPayment,
} from "../../../lib/supabase/admin-purchases";
import { insertSupplier, readSupplierInput } from "../../../lib/supabase/admin-contacts";
import { describeError } from "../../../lib/actions";
import { logActivity, requireAdminActor } from "../../../lib/supabase/business";

// Thin on purpose: check the session, read the form, delegate. Rules, money and
// the activity log live in lib/supabase/admin-purchases.ts (testable without a
// session).

export type PurchaseActionState = ActionState & { id?: string; label?: string };

function revalidate(purchaseId?: string | null) {
  revalidatePath("/admin/compras");
  if (purchaseId) revalidatePath(`/admin/compras/${purchaseId}`);
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function photoFrom(formData: FormData): File | null {
  const entry = formData.get("photo");
  return entry instanceof File && entry.size > 0 ? entry : null;
}

function headerInput(formData: FormData) {
  return {
    supplierId: field(formData, "supplierId"),
    purchaseDate: field(formData, "purchaseDate"),
    exchangeRate: field(formData, "exchangeRate"),
    commission: field(formData, "commission"),
    notes: field(formData, "notes"),
  };
}

export async function createPurchaseAction(_state: PurchaseActionState, formData: FormData): Promise<PurchaseActionState> {
  try {
    const actor = await requireAdminActor();
    const result = await createPurchase({ adminId: actor.id, ...headerInput(formData) });
    if (!result.ok) return failure(result.error);
    revalidate(result.id);
    return { ...ok(`Compra ${result.purchaseNumber} abierta. Ya puedes capturar sus tickets.`), id: result.id };
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible abrir la compra."));
  }
}

export async function updatePurchaseAction(_state: PurchaseActionState, formData: FormData): Promise<PurchaseActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "purchaseId");
    const result = await updatePurchaseHeader({ adminId: actor.id, purchaseId, ...headerInput(formData) });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    return ok("Datos de la compra guardados.");
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible guardar la compra."));
  }
}

export async function cancelPurchaseAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "id");
    const result = await cancelPurchase({ adminId: actor.id, purchaseId, reason: field(formData, "reason") });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    return ok("Compra cancelada.");
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible cancelar la compra."));
  }
}

export async function saveTicketAction(_state: PurchaseActionState, formData: FormData): Promise<PurchaseActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "purchaseId");
    const ticketId = field(formData, "ticketId") || undefined;
    const result = await saveTicket({
      adminId: actor.id,
      purchaseId,
      ticketId,
      storeName: field(formData, "storeName"),
      reference: field(formData, "reference"),
      tax: field(formData, "tax"),
      realTotal: field(formData, "realTotal"),
      photo: photoFrom(formData),
      removePhoto: formData.get("removePhoto") === "on",
    });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    return { ...ok(ticketId ? "Ticket guardado." : "Ticket agregado."), id: result.ticketId };
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible guardar el ticket."));
  }
}

export async function deleteTicketAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "purchaseId");
    const result = await deleteTicket({ adminId: actor.id, purchaseId, ticketId: field(formData, "ticketId") });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    return ok("Ticket borrado.");
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible borrar el ticket."));
  }
}

export async function saveItemAction(_state: PurchaseActionState, formData: FormData): Promise<PurchaseActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "purchaseId");
    const itemId = field(formData, "itemId") || undefined;
    const result = await saveItem({
      adminId: actor.id,
      purchaseId,
      ticketId: field(formData, "ticketId"),
      itemId,
      name: field(formData, "name"),
      variant: field(formData, "variant"),
      quantity: field(formData, "quantity"),
      unitPrice: field(formData, "unitPrice"),
      photo: photoFrom(formData),
      removePhoto: formData.get("removePhoto") === "on",
    });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    return { ...ok(itemId ? "Artículo guardado." : "Artículo agregado."), id: result.itemId };
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible guardar el artículo."));
  }
}

export async function deleteItemAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "purchaseId");
    const result = await deleteItem({ adminId: actor.id, purchaseId, itemId: field(formData, "itemId") });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    return ok("Artículo borrado.");
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible borrar el artículo."));
  }
}

export async function confirmPurchaseAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "id");
    const result = await confirmPurchase({
      adminId: actor.id,
      purchaseId,
      acknowledgeDifference: formData.get("acknowledgeDifference") === "on",
    });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    const photos = result.missingTicketPhotos
      ? ` Ojo: ${result.missingTicketPhotos} ticket(s) quedaron sin foto.`
      : "";
    return ok(`Compra confirmada. Los artículos quedaron como comprados, pendientes de envío.${photos}`);
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible confirmar la compra."));
  }
}

export async function registerPaymentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const purchaseId = field(formData, "purchaseId") || null;
    const result = await registerShopperPayment({
      adminId: actor.id,
      supplierId: field(formData, "supplierId"),
      purchaseId,
      amount: field(formData, "amount"),
      paidOn: field(formData, "paidOn"),
      method: field(formData, "method"),
      note: field(formData, "note"),
    });
    if (!result.ok) return failure(result.error);
    revalidate(purchaseId);
    return ok("Abono registrado.");
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible registrar el abono."));
  }
}

export async function voidPaymentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const result = await voidShopperPayment({ adminId: actor.id, paymentId: field(formData, "paymentId"), reason: field(formData, "reason") });
    if (!result.ok) return failure(result.error);
    revalidate(result.purchaseId);
    return ok("Abono anulado.");
  } catch (error) {
    return failure(describePurchaseError(error, "No fue posible anular el abono."));
  }
}

/**
 * "Crear shopper" from the purchase form: a shopper IS a supplier, so this runs
 * the same validation and insert as /admin/proveedores and returns the new id
 * so the form can select it right away.
 */
export async function createShopperAction(_state: PurchaseActionState, formData: FormData): Promise<PurchaseActionState> {
  try {
    const actor = await requireAdminActor();
    const parsed = readSupplierInput(formData);
    if (!parsed.ok) return failure(parsed.error.replace("del proveedor", "del shopper"));
    let supplierId: string;
    try {
      supplierId = await insertSupplier(actor.id, parsed.values);
    } catch (error) {
      return failure(describeError(error, "No fue posible crear el shopper."));
    }
    await logActivity({
      adminUserId: actor.id,
      action: "SUPPLIER_CREATED",
      entityType: "suppliers",
      entityId: supplierId,
      newData: { ...parsed.values, from: "compras" },
    });
    revalidatePath("/admin/proveedores");
    revalidatePath("/admin/compras/nueva");
    revalidatePath("/admin/compras");
    const label = parsed.values.company ? `${parsed.values.name} · ${parsed.values.company}` : parsed.values.name;
    return { ...ok(`Shopper "${parsed.values.name}" creado.`), id: supplierId, label };
  } catch (error) {
    return failure(describeError(error, "No fue posible crear el shopper."));
  }
}
