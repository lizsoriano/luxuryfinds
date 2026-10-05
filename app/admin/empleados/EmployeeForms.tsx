"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { createEmployeeAction, resetEmployeePasswordAction } from "./actions";

function Message({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="form-message form-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="form-message form-success" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

function PasswordInput({ id, label }: { id: string; label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <span className="admin-password-row">
        <input
          id={id}
          className="input"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
        <button type="button" className="button button-secondary button-small" onClick={() => setVisible((value) => !value)}>
          {visible ? "Ocultar" : "Ver"}
        </button>
      </span>
      <small className="admin-field-note">Mínimo 8 caracteres, con letras y números. Dísela en persona.</small>
    </label>
  );
}

/** Alta de empleado: the owner types name, email, initial password and (optional) phone. */
export function NewEmployeeDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [state, formAction, pending] = useActionState(createEmployeeAction, emptyActionState);

  return (
    <>
      <Button type="button" size="small" onClick={() => setOpen(true)} disabled={disabled}>
        + Nuevo empleado
      </Button>
      <Dialog
        open={open}
        title="Nuevo empleado"
        onClose={() => {
          setOpen(false);
          setFormKey((key) => key + 1);
        }}
        className="dialog-wide"
      >
        <form key={formKey} action={formAction} className="dialog-form admin-form-grid">
          <label className="field field-wide" htmlFor="employee-name">
            <span>Nombre *</span>
            <input id="employee-name" className="input" name="displayName" required maxLength={80} placeholder="Ej. Ana López" />
          </label>
          <label className="field" htmlFor="employee-email">
            <span>Correo (con él inicia sesión) *</span>
            <input id="employee-email" className="input" name="email" type="email" autoComplete="off" required />
          </label>
          <label className="field" htmlFor="employee-phone">
            <span>Celular</span>
            <input id="employee-phone" className="input" name="phone" inputMode="tel" placeholder="Opcional" />
          </label>
          <div className="field-wide">
            <PasswordInput id="employee-password" label="Contraseña inicial *" />
          </div>
          <p className="admin-hint field-wide">
            El empleado entra en /login con su correo y esta contraseña y solo ve su panel: inventario en La Paz, recepción y
            entregas. No ve costos de compra, comisiones del shopper, Balance, Cobranza ni Configuración, y no puede borrar
            registros ni ajustar pagos confirmados.
          </p>
          <div className="field-wide">
            <Message state={state} />
          </div>
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Creando…" : "Crear acceso"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function ResetPasswordDialog({ employeeId, name }: { employeeId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(resetEmployeePasswordAction, emptyActionState);
  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>
        Restablecer contraseña
      </Button>
      <Dialog open={open} title={`Nueva contraseña para ${name}`} onClose={() => setOpen(false)}>
        <form action={formAction} className="dialog-form">
          <input type="hidden" name="id" value={employeeId} />
          <PasswordInput id="employee-new-password" label="Nueva contraseña *" />
          <Message state={state} />
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Guardando…" : "Guardar contraseña"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
