"use client";

import { useActionState, useRef } from "react";
import { changePasswordAction } from "../../app/cuenta/password-actions";
import { emptyActionState, type ActionState } from "../../lib/actions";
import { Button } from "../ui/Button";
import { Input } from "../ui/Fields";

export function ChangePasswordForm() {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (previous: ActionState, data: FormData) => {
    const result = await changePasswordAction(previous, data);
    if (result.success) form.current?.reset();
    return result;
  }, emptyActionState);
  return <form ref={form} action={action} className="dialog-form">
    <Input id="current-password" name="currentPassword" label="Contraseña actual" type="password" autoComplete="current-password" required />
    <Input id="new-password" name="password" label="Nueva contraseña" type="password" autoComplete="new-password" minLength={8} required />
    <Input id="confirm-password" name="confirmation" label="Confirmar nueva contraseña" type="password" autoComplete="new-password" minLength={8} required />
    {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
    {state.success && <p className="form-message" role="status">{state.success}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Cambiar contraseña"}</Button>
  </form>;
}
