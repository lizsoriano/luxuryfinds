"use client";

import { useActionState } from "react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Fields";
import { signupAction, type SignupState } from "./actions";

const initialState: SignupState = { error: null };

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signupAction, initialState);
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <Input id="firstName" name="firstName" label="Nombre" placeholder="Tu nombre" autoComplete="given-name" required />
      <Input id="lastName" name="lastName" label="Apellido" placeholder="Tu apellido" autoComplete="family-name" required />
      <Input id="phone" name="phone" label="Número de celular" placeholder="612 123 4567" autoComplete="tel" required />
      <Input id="email" name="email" label="Correo" type="email" placeholder="correo@ejemplo.com" autoComplete="email" required />
      <Input id="password" name="password" label="Contraseña" type="password" placeholder="Mínimo 8 caracteres" autoComplete="new-password" minLength={8} required />
      {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
      <Button type="submit" fullWidth disabled={pending}>{pending ? "Creando cuenta…" : "Crear mi cuenta"} <span aria-hidden>→</span></Button>
    </form>
  );
}
