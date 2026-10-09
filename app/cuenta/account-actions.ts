"use server";

import { revalidatePath } from "next/cache";
import { failure, ok, type ActionState } from "../../lib/actions";
import { getClientProfile } from "../../lib/supabase/auth";
import { adminDb } from "../../lib/supabase/business";

// Small self-service writes of the client's panel. Each one verifies the
// session first and only touches rows of that verified client id.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marks one notice (id) or all of hers ("all") as read. */
export async function markNotificationsReadAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { user, profile } = await getClientProfile();
  if (!profile) return failure("Tu perfil aún no está listo.");
  const id = String(formData.get("id") ?? "all");
  if (id !== "all" && !UUID.test(id)) return failure("Aviso no encontrado.");
  let query = adminDb().from("notifications").update({ read_at: new Date().toISOString() }).eq("client_id", user.id).is("read_at", null);
  if (id !== "all") query = query.eq("id", id);
  const { error } = await query;
  if (error) return failure("No pudimos actualizar tus avisos. Intenta de nuevo.");
  revalidatePath("/cuenta", "layout");
  return ok(id === "all" ? "Listo, todos tus avisos están leídos." : "Aviso marcado como leído.");
}

/** Her delivery address (clients.address), used when an order goes by DiDi. */
export async function updateAddressAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { user, profile } = await getClientProfile();
  if (!profile || profile.status !== "ACTIVE") return failure("Tu cuenta no está activa.");
  const address = String(formData.get("address") ?? "").replace(/\s+/g, " ").trim();
  if (address.length > 300) return failure("La dirección es muy larga (máximo 300 caracteres).");
  const { error } = await adminDb().from("clients").update({ address: address || null, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) return failure("No pudimos guardar tu dirección. Intenta de nuevo.");
  revalidatePath("/cuenta/perfil");
  return ok(address ? "Dirección guardada." : "Dirección borrada.");
}
