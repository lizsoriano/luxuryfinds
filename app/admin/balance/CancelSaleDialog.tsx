"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Textarea } from "../../../components/ui/Fields";
import { cancelSaleAction } from "../vender/actions";
import { emptyActionState, type ActionState } from "../../../lib/actions";

export function CancelSaleDialog({ saleId, reference }: { saleId: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await cancelSaleAction(previous, formData);
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
      <Dialog open={open} title={`Cancelar venta ${reference}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="id" value={saleId} />
          <p className="admin-hint">
            Se libera el inventario que esta venta había descontado y deja de contar en el Balance. No se puede
            deshacer.
          </p>
          <Textarea id="cancel-sale-reason" name="reason" label="Motivo *" rows={3} required />
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
              {pending ? "Cancelando…" : "Cancelar venta"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
