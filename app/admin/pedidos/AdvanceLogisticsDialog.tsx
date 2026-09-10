"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Select, Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { LOGISTICS_STATUS_LABELS } from "../../../lib/format";
import { advanceLogisticsStatusAction } from "./actions";

const ORDER = [
  "WAITING_TO_ORDER",
  "READY_TO_ORDER",
  "ORDERED",
  "IN_TRANSIT",
  "RECEIVED_LA_PAZ",
  "READY_FOR_DELIVERY",
  "DELIVERED",
];

export function AdvanceLogisticsDialog({
  ticketId,
  ticketNumber,
  currentStatus,
}: {
  ticketId: string;
  ticketNumber: string;
  currentStatus: string;
}) {
  const [open, setOpen] = useState(false);
  const options = ORDER.filter((status) => status !== currentStatus);
  const [status, setStatus] = useState(options[0] ?? currentStatus);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await advanceLogisticsStatusAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>
        Actualizar estado
      </Button>
      <Dialog open={open} title={`Actualizar ticket ${ticketNumber}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="ticketId" value={ticketId} />
          <p className="admin-hint">
            Estado actual: <strong>{LOGISTICS_STATUS_LABELS[currentStatus] ?? currentStatus}</strong>. Se le avisa a
            la clienta por Telegram y en su cuenta.
          </p>
          <Select id="logistics-status" name="status" label="Nuevo estado" value={status} onChange={(event) => setStatus(event.target.value)}>
            {options.map((value) => (
              <option key={value} value={value}>
                {LOGISTICS_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <Textarea id="logistics-note" name="note" label="Nota (opcional)" rows={2} placeholder="Ej. Tienda: Sephora · Folio de compra: 12345" />
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
              {pending ? "Guardando…" : "Actualizar"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
