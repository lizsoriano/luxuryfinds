"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Fields";
import { PasswordInput } from "../../../components/ui/PasswordInput";
import { loginAction, phoneLoginAction, type LoginState } from "./actions";

async function signIn(previous: LoginState, formData: FormData): Promise<LoginState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (identifier.includes("@")) return loginAction(previous, formData);
  formData.set("phone", identifier);
  return phoneLoginAction(previous, formData);
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, { error: null });
  return <form action={action} className="login-simple-form">
    <input type="hidden" name="next" value={next}/>
    <Input id="identifier" name="identifier" label="Celular o correo" placeholder="Celular o correo" autoComplete="username" required/>
    <PasswordInput id="login-password" name="password" label="Contraseña" placeholder="Contraseña" autoComplete="current-password" required/>
    {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Ingresando…" : "Ingresar"}</Button>
    <Link className="login-forgot-link" href="/recuperar-acceso">Olvidé mi contraseña</Link>
    <p className="auth-switch-link">¿Aún no tienes cuenta? <Link href={`/crear-cuenta?next=${encodeURIComponent(next)}`}>Crear cuenta</Link></p>
  </form>;
}