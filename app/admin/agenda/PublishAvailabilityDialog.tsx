"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { createAvailabilityAction } from "./actions";

export function PublishAvailabilityDialog({ locationId, date }: { locationId: string; date: string }) {
  const [open, setOpen] = useState(false);
  const [enabledPickup, setEnabledPickup] = useState(true);
  const [enabledDidi, setEnabledDidi] = useState(true);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await createAvailabilityAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" size="small" onClick={() => setOpen(true)}>
        Publicar disponibilidad
      </Button>
      <Dialog open={open} title="Publicar disponibilidad" onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="locationId" value={locationId} />
          <Input id="availability-date" name="date" label="Fecha *" type="date" defaultValue={date} required />
          <div className="admin-form-grid">
            <Input id="availability-start" name="startTime" label="Desde *" type="time" required />
            <Input id="availability-end" name="endTime" label="Hasta *" type="time" required />
          </div>
          <p className="admin-hint">Se generan horarios de 10 minutos automáticamente dentro de esta ventana.</p>
          <label className="admin-switch" htmlFor="availability-pickup">
            <input id="availability-pickup" type="checkbox" name="enabledPickup" checked={enabledPickup} onChange={(event) => setEnabledPickup(event.target.checked)} />
            <span>Permite recoger en el local</span>
          </label>
          <label className="admin-switch" htmlFor="availability-didi">
            <input id="availability-didi" type="checkbox" name="enabledDidi" checked={enabledDidi} onChange={(event) => setEnabledDidi(event.target.checked)} />
            <span>Permite entrega por DiDi</span>
          </label>
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
              {pending ? "Publicando…" : "Publicar"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
