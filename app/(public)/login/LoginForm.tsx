"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Fields";
import { loginAction, phoneLoginAction, type LoginState, type PhoneLoginState } from "./actions";

const initialState: LoginState = { error: null };
const initialPhoneState: PhoneLoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "phone">("phone");
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [phoneState, phoneAction, phonePending] = useActionState(phoneLoginAction, initialPhoneState);

  return (
    <div className="login-form-wrap">
      <div className="login-mode-switch" role="tablist" aria-label="Forma de acceso">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "phone"}
          className={mode === "phone" ? "active" : ""}
          onClick={() => setMode("phone")}
        >
          Solo mi celular
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          className={mode === "password" ? "active" : ""}
          onClick={() => setMode("password")}
        >
          Correo y contraseña
        </button>
      </div>

      {mode === "phone" ? (
        <form action={phoneAction}>
          <input type="hidden" name="next" value={next} />
          <Input id="phone" name="phone" label="Tu celular" placeholder="+52..." autoComplete="tel" required />
          <p className="login-help" style={{ marginTop: 0, marginBottom: 14 }}>
            Sin contraseña: entra con el mismo celular con el que te registramos.
          </p>
          {phoneState.error && (
            <p className="form-message form-error" role="alert">
              {phoneState.error}
            </p>
          )}
          <Button type="submit" fullWidth disabled={phonePending}>
            {phonePending ? "Entrando…" : "Entrar con mi celular"} <span aria-hidden>→</span>
          </Button>
        </form>
      ) : (
        <form action={action}>
          <input type="hidden" name="next" value={next} />
          <Input
            id="identifier"
            name="identifier"
            label="Correo o número de celular"
            placeholder="correo@ejemplo.com"
            autoComplete="username"
            required
          />
          <Input
            id="password"
            name="password"
            label="Contraseña"
            type="password"
            placeholder="Tu contraseña"
            autoComplete="current-password"
            required
          />
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <Button type="submit" fullWidth disabled={pending}>
            {pending ? "Entrando…" : "Entrar a mi cuenta"} <span aria-hidden>→</span>
          </Button>
        </form>
      )}
    </div>
  );
}
