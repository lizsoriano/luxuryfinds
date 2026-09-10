"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input, Select } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { formatMoney } from "../../../lib/format";
import { completeRefundAction } from "./actions";

export function CompleteRefundDialog({ requestId, ticketNumber, suggestedAmountCents }: { requestId: string; ticketNumber: string; suggestedAmountCents: number }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await completeRefundAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" size="small" onClick={() => setOpen(true)}>
        Completar
      </Button>
      <Dialog open={open} title={`Completar reembolso · ${ticketNumber}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="id" value={requestId} />
          <p className="admin-hint">Registra esto después de hacer la transferencia real desde tu banco.</p>
          <Input
            id="refund-amount"
            name="amount"
            label="Monto reembolsado *"
            type="number"
            min="0.01"
            step="0.01"
            defaultValue={(suggestedAmountCents / 100).toFixed(2)}
            required
          />
          <p className="admin-hint">Total del ticket: {formatMoney(suggestedAmountCents)}</p>
          <Select id="refund-method" name="method" label="Método *" defaultValue="Transferencia">
            <option value="Transferencia">Transferencia bancaria</option>
            <option value="Efectivo">Efectivo</option>
          </Select>
          <Input id="refund-reference" name="reference" label="Referencia / folio *" required />
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
              {pending ? "Guardando…" : "Registrar reembolso"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
