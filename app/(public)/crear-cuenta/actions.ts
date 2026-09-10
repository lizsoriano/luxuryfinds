"use server";

import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export type SignupState = { error: string | null };

function safeReturnPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/cuenta";
  }
  return value;
}

export async function signupAction(
  _previousState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").replace(/[\s()-]/g, "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = formData.get("next");

  if (!firstName || !lastName || !phone || !email || !password) {
    return { error: "Completa todos los campos." };
  }
  if (!email.includes("@")) {
    return { error: "Ingresa un correo válido." };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  const admin = createAdminSupabaseClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    phone,
    email_confirm: true,
    phone_confirm: true,
  });

  if (createError || !created.user) {
    const message = createError?.message ?? "";
    if (/already|registered|exists|duplicate/i.test(message)) {
      return { error: "Ya existe una cuenta con ese correo o celular." };
    }
    return { error: "No fue posible crear tu cuenta. Intenta de nuevo." };
  }

  const userId = created.user.id;

  const { error: clientError } = await admin
    .schema("luxury_finds")
    .from("clients")
    .insert({
      id: userId,
      phone,
      first_name: firstName,
      last_name: lastName,
      email,
      status: "ACTIVE",
    });

  if (clientError) {
    // Roll back the auth user so we don't leave an orphaned account without a client profile.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (clientError.code === "23505") {
      return { error: "Ya existe una cuenta con ese correo o celular." };
    }
    return { error: "No fue posible completar tu registro. Intenta de nuevo." };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      return { error: "Tu cuenta se creó. Inicia sesión con tus datos." };
    }
  } catch {
    return { error: "Tu cuenta se creó. Inicia sesión con tus datos." };
  }

  redirect(safeReturnPath(next));
}
