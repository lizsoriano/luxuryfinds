"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { cancelBookingAction } from "./actions";

export function CancelBookingDialog({ bookingId, ticketNumber }: { bookingId: string; ticketNumber: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await cancelBookingAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant="danger" size="small" onClick={() => setOpen(true)}>
        Cancelar
      </Button>
      <Dialog open={open} title={`Cancelar entrega · ${ticketNumber}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="bookingId" value={bookingId} />
          <p className="admin-hint">El ticket vuelve a quedar listo para agendar en otro horario. Se le avisa a la clienta.</p>
          <Textarea id="cancel-booking-reason" name="reason" label="Motivo *" rows={2} required />
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button type="submit" variant="danger" size="small" disabled={pending}>
              {pending ? "Cancelando…" : "Cancelar entrega"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
