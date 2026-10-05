"use server";
import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../../lib/actions";
import { parseSalePriceToCents } from "../../../lib/supabase/purchase-math";
import { adminDb, adminStorage, PRODUCT_IMAGE_BUCKET, requireAdminActor } from "../../../lib/supabase/business";
import { reservationError } from "../../../lib/supabase/incoming-reservations";
export async function saveIncomingOfferAction(_state: ActionState, data: FormData): Promise<ActionState> {
  let uploaded: string | null = null;
  try {
    const actor = await requireAdminActor();
    const itemId = String(data.get("itemId") ?? "");
    const price = parseSalePriceToCents(data.get("price"));
    if (!price.ok) return failure(price.error);
    if (price.value <= 0) return failure("El precio de venta debe ser mayor a $0.");
    const { data: item, error: itemError } = await adminDb().from("incoming_item_availability").select("photo_storage_key,original_photo_storage_key").eq("purchase_item_id", itemId).maybeSingle();
    if (itemError) return failure(reservationError(itemError));
    if (!item) return failure("Artículo no encontrado.");
    let photoKey: string | null = item.photo_storage_key ?? item.original_photo_storage_key;
    const photo = data.get("photo");
    if (photo instanceof File && photo.size) {
      if (photo.type !== "image/jpeg" || photo.size > 850 * 1024) return failure("Reduce la foto antes de guardarla.");
      uploaded = `incoming-offers/${itemId}/${crypto.randomUUID()}.jpg`;
      const upload = await adminStorage().from(PRODUCT_IMAGE_BUCKET).upload(uploaded, photo, { contentType: "image/jpeg", upsert: false });
      if (upload.error) throw new Error(upload.error.message);
      photoKey = uploaded;
    }
    const published = data.get("published") === "on";
    if (published && !photoKey) return failure("Agrega una foto antes de publicar.");
    const { error } = await adminDb().rpc("save_incoming_offer", { p_item: itemId, p_price: price.value, p_eta: String(data.get("eta") ?? "") || null, p_photo: photoKey, p_public: published, p_actor: actor.id });
    if (error) throw new Error(reservationError(error));
    uploaded = null;
    revalidatePath("/admin/proximamente"); revalidatePath("/proximamente");
    return ok("Precio, foto y publicación guardados.");
  } catch (error) {
    if (uploaded) await adminStorage().from(PRODUCT_IMAGE_BUCKET).remove([uploaded]);
    return failure(error instanceof Error ? error.message : "No se pudo guardar la publicación.");
  }
}
