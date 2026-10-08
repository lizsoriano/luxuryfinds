"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { rejectDeliveryRequestAction } from "./actions";

/** "Rechazar" a client's delivery request: the reason goes to her (campanita + Telegram). */
export function RejectRequestDialog({ visitId, clientName, when }: { visitId: string; clientName: string; when: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await rejectDeliveryRequestAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant="danger" size="small" onClick={() => setOpen(true)}>
        Rechazar
      </Button>
      <Dialog open={open} title={`Rechazar solicitud · ${clientName}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="visitId" value={visitId} />
          <p className="admin-hint">
            Se libera el horario ({when}) y los productos vuelven a quedar listos para que ella elija otro. Le avisamos con el motivo.
          </p>
          <Textarea id={`reject-request-reason-${visitId}`} name="reason" label="Motivo para la clienta *" rows={2} maxLength={300} placeholder="Ej.: Ese día no estaré en el punto; elige el jueves, por favor." required />
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
              {pending ? "Rechazando…" : "Rechazar solicitud"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
