"use client";

import { useActionState } from "react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Fields";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return <form action={action}><input type="hidden" name="next" value={next}/><Input id="identifier" name="identifier" label="Correo o número de celular" placeholder="correo@ejemplo.com" autoComplete="username" required/><Input id="password" name="password" label="Contraseña" type="password" placeholder="Tu contraseña" autoComplete="current-password" required/>{state.error && <p className="form-message form-error" role="alert">{state.error}</p>}<Button type="submit" fullWidth disabled={pending}>{pending ? "Entrando…" : "Entrar a mi cuenta"} <span aria-hidden>→</span></Button></form>;
}
