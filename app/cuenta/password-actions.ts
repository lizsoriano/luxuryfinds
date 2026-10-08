"use server";

import { failure, ok, type ActionState } from "../../lib/actions";
import { getClientProfile } from "../../lib/supabase/auth";

export async function changePasswordAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user, profile } = await getClientProfile();
  if (!profile || profile.status !== "ACTIVE") return failure("Tu cuenta no está activa.");
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!currentPassword || password.length < 8) return failure("Ingresa tu contraseña actual y una nueva de al menos 8 caracteres.");
  if (password !== String(formData.get("confirmation") ?? "")) return failure("Las contraseñas nuevas no coinciden.");
  if (password === currentPassword) return failure("Elige una contraseña diferente a la actual.");
  if (!user.email) return failure("Pide a Luxury Finds que te asigne una contraseña de acceso.");
  try {
    const verification = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verification.error || verification.data.user?.id !== user.id) return failure("La contraseña actual no es correcta.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return failure("No fue posible cambiar la contraseña. Intenta de nuevo.");
    return ok("Contraseña actualizada. Úsala la próxima vez que entres con tu celular.");
  } catch {
    return failure("No fue posible cambiar la contraseña. Intenta de nuevo.");
  }
}
