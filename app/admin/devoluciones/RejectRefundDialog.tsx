"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { rejectRefundAction } from "./actions";

export function RejectRefundDialog({ requestId, ticketNumber }: { requestId: string; ticketNumber: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await rejectRefundAction(previous, formData);
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
      <Dialog open={open} title={`Rechazar solicitud · ${ticketNumber}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="id" value={requestId} />
          <p className="admin-hint">Se le avisa a la clienta por Telegram con este motivo.</p>
          <Textarea id="reject-refund-note" name="note" label="Motivo *" rows={3} required />
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
