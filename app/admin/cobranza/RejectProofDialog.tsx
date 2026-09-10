"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { rejectPaymentProofAction } from "./actions";

export function RejectProofDialog({ proofId, ticketNumber }: { proofId: string; ticketNumber: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await rejectPaymentProofAction(previous, formData);
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
      <Dialog open={open} title={`Rechazar comprobante · ${ticketNumber}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="id" value={proofId} />
          <p className="admin-hint">La clienta recibe este motivo por Telegram y puede subir un comprobante nuevo.</p>
          <Textarea id="reject-reason" name="reason" label="Motivo *" rows={3} required placeholder="Ej. El monto no coincide con lo reportado" />
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
              {pending ? "Rechazando…" : "Rechazar comprobante"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
