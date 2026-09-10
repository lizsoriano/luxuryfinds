"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Select } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { formatDateTime } from "../../../lib/format";
import { bookSlotAction } from "./actions";

export type BookableTicket = { id: string; label: string };

export function BookSlotDialog({ slotId, startsAt, tickets }: { slotId: string; startsAt: string; tickets: BookableTicket[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await bookSlotAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)} disabled={!tickets.length}>
        Reservar
      </Button>
      <Dialog open={open} title={`Reservar horario · ${formatDateTime(startsAt)}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="slotId" value={slotId} />
          {tickets.length ? (
            <>
              <Select id="book-ticket" name="ticketId" label="Ticket *" defaultValue="">
                <option value="" disabled>
                  Elige un ticket…
                </option>
                {tickets.map((ticket) => (
                  <option key={ticket.id} value={ticket.id}>
                    {ticket.label}
                  </option>
                ))}
              </Select>
              <Select id="book-type" name="deliveryType" label="Modalidad *" defaultValue="PICKUP">
                <option value="PICKUP">Recoger en el local</option>
                <option value="DIDI">Entrega por DiDi</option>
              </Select>
            </>
          ) : (
            <p className="admin-hint">No hay tickets listos para entrega (READY_FOR_DELIVERY) en este momento.</p>
          )}
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending || !tickets.length}>
              {pending ? "Reservando…" : "Reservar"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
