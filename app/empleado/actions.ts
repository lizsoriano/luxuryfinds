"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, type ActionState } from "../../lib/actions";
import { parseMoneyToCents } from "../../lib/format";
import { requireStaffActor } from "../../lib/supabase/business";
import { confirmStaffDelivery } from "../../lib/supabase/staff-deliveries";
import {
  addStaffProductPhoto,
  createStaffProduct,
  editStaffProduct,
  editStaffVariant,
  recordStaffEntry,
  updateStaffVariantPrice,
} from "../../lib/supabase/staff-inventory";

// Staff panel server actions. Each one only (1) checks that the caller is an
// active OWNER/EMPLOYEE with requireStaffActor and (2) hands the form to the
// lib/supabase/staff-*.ts function with the actor id. Nothing here deletes a
// record, reads a cost, or touches a confirmed payment.

export type StaffActionState = ActionState & { productId?: string; confirmationId?: string };

function photoFrom(formData: FormData) {
  const entry = formData.get("photo");
  return entry instanceof File && entry.size > 0 ? entry : null;
}

function revalidateInventory(productId?: string) {
  revalidatePath("/empleado/inventario");
  if (productId) revalidatePath(`/empleado/inventario/${productId}`);
  revalidatePath("/admin/productos/entrega-inmediata");
  revalidatePath("/admin/inventario");
}

export async function createStaffProductAction(_state: StaffActionState, formData: FormData): Promise<StaffActionState> {
  try {
    const actor = await requireStaffActor();
    const names = formData.getAll("variantName").map((value) => String(value));
    const prices = formData.getAll("variantPrice");
    const quantities = formData.getAll("variantQuantity");
    const variants = names.map((name, index) => ({
      name,
      priceCents: parseMoneyToCents(prices[index] ?? "") ?? Number.NaN,
      quantity: String(quantities[index] ?? "").trim() === "" ? 0 : Number(String(quantities[index]).trim()),
    }));
    const result = await createStaffProduct({
      adminId: actor.id,
      name: String(formData.get("name") ?? ""),
      categoryId: String(formData.get("categoryId") ?? "").trim() || null,
      variants,
      photo: photoFrom(formData),
    });
    if (!result.ok) return failure(result.error);
    revalidateInventory(result.productId);
    return { error: null, success: result.message, productId: result.productId };
  } catch (error) {
    return failure(describeError(error, "No fue posible crear el producto."));
  }
}

export async function editStaffProductAction(_state: StaffActionState, data: FormData): Promise<StaffActionState> {
  try {
    const actor = await requireStaffActor();
    const result = await editStaffProduct({ adminId: actor.id, productId: String(data.get("productId") ?? ""), name: String(data.get("name") ?? ""), categoryId: String(data.get("categoryId") ?? "").trim() || null });
    if (!result.ok) return failure(result.error);
    revalidateInventory(result.productId);
    return { error: null, success: result.message, productId: result.productId };
  } catch (error) { return failure(describeError(error, "No se pudieron guardar los datos.")); }
}

export async function editStaffVariantAction(_state: StaffActionState, data: FormData): Promise<StaffActionState> {
  try {
    const actor = await requireStaffActor();
    const rawQuantity = String(data.get("quantity") ?? "").trim();
    const result = await editStaffVariant({ adminId: actor.id, variantId: String(data.get("variantId") ?? ""), name: String(data.get("name") ?? ""), priceCents: parseMoneyToCents(data.get("price")) ?? Number.NaN, quantity: rawQuantity ? Number(rawQuantity) : Number.NaN });
    if (!result.ok) return failure(result.error);
    revalidateInventory(result.productId);
    return { error: null, success: result.message, productId: result.productId };
  } catch (error) { return failure(describeError(error, "No se pudo guardar la variante.")); }
}

export async function recordStaffEntryAction(_state: StaffActionState, formData: FormData): Promise<StaffActionState> {
  try {
    const actor = await requireStaffActor();
    const result = await recordStaffEntry({
      adminId: actor.id,
      variantId: String(formData.get("variantId") ?? ""),
      quantity: formData.get("quantity"),
      note: String(formData.get("note") ?? ""),
      photo: photoFrom(formData),
    });
    if (!result.ok) return failure(result.error);
    revalidateInventory(result.productId);
    return { error: null, success: result.message, productId: result.productId };
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar la entrada."));
  }
}

export async function updateStaffPriceAction(_state: StaffActionState, formData: FormData): Promise<StaffActionState> {
  try {
    const actor = await requireStaffActor();
    const priceCents = parseMoneyToCents(formData.get("price"));
    if (priceCents === null) return failure("Escribe el precio de venta.");
    const result = await updateStaffVariantPrice({ adminId: actor.id, variantId: String(formData.get("variantId") ?? ""), priceCents });
    if (!result.ok) return failure(result.error);
    revalidateInventory(result.productId);
    return { error: null, success: result.message, productId: result.productId };
  } catch (error) {
    return failure(describeError(error, "No fue posible actualizar el precio."));
  }
}

export async function addStaffPhotoAction(_state: StaffActionState, formData: FormData): Promise<StaffActionState> {
  try {
    const actor = await requireStaffActor();
    const result = await addStaffProductPhoto({ adminId: actor.id, productId: String(formData.get("productId") ?? ""), photo: photoFrom(formData) });
    if (!result.ok) return failure(result.error);
    revalidateInventory(result.productId);
    return { error: null, success: result.message, productId: result.productId };
  } catch (error) {
    return failure(describeError(error, "No fue posible agregar la foto."));
  }
}

export async function confirmDeliveryAction(_state: StaffActionState, formData: FormData): Promise<StaffActionState> {
  try {
    const actor = await requireStaffActor();
    const bookingId = String(formData.get("bookingId") ?? "");
    const ticketIds = formData.getAll("ticketId").map((value) => String(value));
    const tickets = ticketIds.map((ticketId) => ({ ticketId, balanceCents: Number(formData.get(`balance:${ticketId}`)) }));
    const methodRaw = String(formData.get("method") ?? "");
    const amountCents = parseMoneyToCents(formData.get("amount")) ?? 0;
    const result = await confirmStaffDelivery({
      adminId: actor.id,
      bookingId,
      tickets,
      method: methodRaw === "CASH" || methodRaw === "TRANSFER" ? methodRaw : null,
      amountCents,
      reference: String(formData.get("reference") ?? ""),
      receivedBy: String(formData.get("receivedBy") ?? "") === "OTHER" ? "OTHER" : "CLIENT",
      receiverName: String(formData.get("receiverName") ?? ""),
      receiverRelationship: String(formData.get("receiverRelationship") ?? ""),
      balanceAcknowledged: formData.get("balanceAcknowledged") === "on",
      notes: String(formData.get("notes") ?? ""),
      proofPhoto: photoFrom(formData),
    });
    if (!result.ok) return failure(result.error);
    revalidatePath("/empleado/entregas");
    revalidatePath("/empleado/confirmar");
    revalidatePath(`/empleado/entregas/${bookingId}`);
    revalidatePath("/admin/agenda");
    revalidatePath("/admin/cobranza");
    revalidatePath("/admin/pedidos");
    return { error: null, success: result.message, confirmationId: result.confirmationId };
  } catch (error) {
    return failure(describeError(error, "No fue posible confirmar la entrega."));
  }
}
