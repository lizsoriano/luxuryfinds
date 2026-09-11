"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";
import { adminDb, logActivity, requireAdminActor } from "../../../lib/supabase/business";

function normalizePhone(value: FormDataEntryValue | null) {
  return String(value ?? "").replace(/[\s()-]/g, "").trim();
}

function revalidate(id?: string) {
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/vender");
  if (id) revalidatePath(`/admin/clientes/${id}`);
}

/**
 * A client row is bound to auth.users (that is how the storefront account, the
 * order history and every RLS policy find it), so creating one from the admin
 * panel means creating the auth user first — exactly like the public signup flow.
 */
export async function createClientAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const phone = normalizePhone(formData.get("phone"));
    const email = String(formData.get("email") ?? "").trim().toLowerCase();

    if (!firstName || !lastName) return failure("Nombre y apellido son obligatorios.");
    if (!phone) return failure("El celular es obligatorio: identifica a la clienta en todo el sistema.");
    if (email && !email.includes("@")) return failure("El correo no es válido.");

    const admin = createAdminSupabaseClient();
    const password = `LF-${crypto.randomUUID()}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      phone,
      password,
      phone_confirm: true,
      ...(email ? { email, email_confirm: true } : {}),
    });

    if (createError || !created?.user) {
      const message = createError?.message ?? "";
      if (/already|registered|exists|duplicate/i.test(message)) {
        return failure("Ya existe una cuenta con ese celular o correo.");
      }
      return failure(`No fue posible crear la cuenta de acceso: ${message || "error desconocido"}`);
    }

    const userId = created.user.id;
    const { error: clientError } = await adminDb().from("clients").insert({
      id: userId,
      phone,
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      instagram: String(formData.get("instagram") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      internal_notes: String(formData.get("notes") ?? "").trim() || null,
      payment_plans_allowed: formData.get("paymentPlansAllowed") === "on",
      status: "ACTIVE",
    });

    if (clientError) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      if (clientError.code === "23505") return failure("Ya existe una clienta con ese celular o correo.");
      return failure(describeError(new Error(clientError.message), "No fue posible registrar a la clienta."));
    }

    await logActivity({
      adminUserId: actor.id,
      action: "CLIENT_CREATED",
      entityType: "clients",
      entityId: userId,
      newData: { firstName, lastName, phone },
    });
    revalidate();
    return ok(`${firstName} ${lastName} quedó registrada. Ya puede entrar al sitio solo con su celular, sin contraseña.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible registrar a la clienta."));
  }
}

export async function updateClientAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    if (!id) return failure("Clienta no encontrada.");

    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const phone = normalizePhone(formData.get("phone"));
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!firstName || !lastName) return failure("Nombre y apellido son obligatorios.");
    if (!phone) return failure("El celular es obligatorio.");
    if (email && !email.includes("@")) return failure("El correo no es válido.");

    const db = adminDb();
    const { data: previous } = await db
      .from("clients")
      .select("first_name, last_name, phone, email, payment_plans_allowed")
      .eq("id", id)
      .maybeSingle();

    const { error } = await db
      .from("clients")
      .update({
        first_name: firstName,
        last_name: lastName,
        phone,
        email: email || null,
        instagram: String(formData.get("instagram") ?? "").trim() || null,
        address: String(formData.get("address") ?? "").trim() || null,
        internal_notes: String(formData.get("notes") ?? "").trim() || null,
        payment_plans_allowed: formData.get("paymentPlansAllowed") === "on",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      if (error.code === "23505") return failure("Otra clienta ya usa ese celular o correo.");
      return failure(describeError(new Error(error.message), "No fue posible actualizar la ficha."));
    }

    await logActivity({
      adminUserId: actor.id,
      action: "CLIENT_UPDATED",
      entityType: "clients",
      entityId: id,
      previousData: previous ?? null,
      newData: { firstName, lastName, phone, email: email || null },
    });
    revalidate(id);
    return ok("Ficha actualizada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible actualizar la ficha."));
  }
}

/** Archiving keeps every ticket, payment and delivery intact; it only takes the
 *  client out of the active lists. `status` already exists for exactly this. */
export async function setClientStatusAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!id) return failure("Clienta no encontrada.");
    if (!["ACTIVE", "INACTIVE", "BLOCKED"].includes(status)) return failure("Estado no válido.");

    const { error } = await adminDb()
      .from("clients")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible cambiar el estado."));

    await logActivity({
      adminUserId: actor.id,
      action: status === "ACTIVE" ? "CLIENT_RESTORED" : "CLIENT_ARCHIVED",
      entityType: "clients",
      entityId: id,
      newData: { status },
    });
    revalidate(id);
    return ok(status === "ACTIVE" ? "Clienta reactivada." : "Clienta archivada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible cambiar el estado."));
  }
}
