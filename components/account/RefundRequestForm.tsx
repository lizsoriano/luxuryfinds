"use client";

import { useActionState } from "react";
import { requestRefund, type RefundState } from "../../app/cuenta/refund-actions";
import { Button } from "../ui/Button";
import { Input, Select, Textarea } from "../ui/Fields";

const initialState: RefundState = { error: null, success: null };

export function RefundRequestForm({ tickets }: { tickets: Array<{ id: string; ticket_number: string }> }) {
  const [state, action, pending] = useActionState(requestRefund, initialState);
  return (
    <form action={action} className="proof-form">
      <Select id="refund-ticket" name="ticketId" label="Ticket" required>
        <option value="">Selecciona un ticket</option>
        {tickets.map((ticket) => (
          <option value={ticket.id} key={ticket.id}>
            {ticket.ticket_number}
          </option>
        ))}
      </Select>
      <Input id="refund-first-name" name="accountHolderFirstName" label="Nombre del titular de la cuenta" required />
      <Input id="refund-last-name" name="accountHolderLastName" label="Apellido del titular" required />
      <Input id="refund-bank" name="bankName" label="Banco" required />
      <Input id="refund-clabe" name="clabe" label="CLABE (18 dígitos)" inputMode="numeric" pattern="\d{18}" maxLength={18} required />
      <Textarea id="refund-reason" name="reason" label="Motivo del reembolso" rows={3} required />
      {state.error && (
        <p className="form-message form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="form-message form-success" role="status">
          {state.success}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Solicitar reembolso"}
      </Button>
    </form>
  );
}
