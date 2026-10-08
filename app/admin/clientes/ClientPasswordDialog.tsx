"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input } from "../../../components/ui/Fields";
import { emptyActionState } from "../../../lib/actions";
import { setClientPasswordAction } from "./actions";

export function ClientPasswordDialog({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setClientPasswordAction, emptyActionState);
  return <>
    <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>Asignar contraseña</Button>
    <Dialog open={open} title="Asignar contraseña de acceso" onClose={() => setOpen(false)}>
      <form action={action} className="dialog-form">
        <input type="hidden" name="id" value={id} />
        <p>Comparte esta contraseña con la clienta. Reemplaza su contraseña anterior y ella podrá cambiarla desde Mi perfil.</p>
        <Input id="access-password" name="password" label="Nueva contraseña" type="password" autoComplete="new-password" minLength={8} required />
        {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
        {state.success && <p className="form-message" role="status">{state.success}</p>}
        <div className="admin-form-actions">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Asignar contraseña"}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
