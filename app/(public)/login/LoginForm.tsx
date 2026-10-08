"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Fields";
import { PasswordInput } from "../../../components/ui/PasswordInput";
import { loginAction, phoneLoginAction, type LoginState, type PhoneLoginState } from "./actions";

const initialState: LoginState = { error: null };
const initialPhoneState: PhoneLoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [remember, setRemember] = useState(false);
  const [mode, setMode] = useState<"password" | "phone">("phone");
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [phoneState, phoneAction, phonePending] = useActionState(phoneLoginAction, initialPhoneState);
  const phone = mode === "phone";
  const error = phone ? phoneState.error : state.error;
  const busy = phone ? phonePending : pending;

  return <div className="login-form-wrap">
    <div className="login-mode-switch" role="tablist" aria-label="Forma de acceso">
      <button type="button" role="tab" aria-selected={phone} className={phone ? "active" : ""} onClick={() => setMode("phone")}>Celular y contraseña</button>
      <button type="button" role="tab" aria-selected={!phone} className={!phone ? "active" : ""} onClick={() => setMode("password")}>Correo y contraseña</button>
    </div>
    <form action={phone ? phoneAction : action}>
      <input type="hidden" name="next" value={next} />
      {phone ? <Input key="phone" id="phone" name="phone" label="Tu celular" placeholder="Tu celular registrado" autoComplete="username" inputMode="tel" required /> : <Input key="email" id="identifier" name="identifier" label="Correo" type="email" placeholder="correo@ejemplo.com" autoComplete="username" required />}
      <PasswordInput key={mode} id="login-password" name="password" label="Contraseña" placeholder="Tu contraseña" autoComplete="current-password" required />
      {phone && <p className="login-help" style={{ marginTop: 0, marginBottom: 14 }}>Usa la contraseña que te dimos o la que elegiste en tu cuenta.</p>}
      <div className="login-access-options">
        <label className="login-remember"><input type="checkbox" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Recuérdame</label>
        <Link href="/recuperar-acceso">¿Olvidaste tu contraseña?</Link>
      </div>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      <Button type="submit" fullWidth disabled={busy}>{busy ? "Entrando…" : phone ? "Entrar con mi celular" : "Entrar a mi cuenta"} <span aria-hidden>→</span></Button>
    </form>
  </div>;
}
