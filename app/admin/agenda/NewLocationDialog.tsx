"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { createLocationAction } from "./actions";

export function NewLocationDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await createLocationAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>
        + Ubicación
      </Button>
      <Dialog open={open} title="Nueva ubicación de entrega" onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <Input id="location-name" name="name" label="Nombre *" placeholder="Ej. Showroom La Paz" required />
          <Input id="location-address" name="address" label="Dirección *" required />
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Guardando…" : "Crear ubicación"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
