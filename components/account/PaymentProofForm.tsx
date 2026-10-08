"use client";

import { useActionState } from "react";
import { uploadPaymentProof, type ProofState } from "../../app/cuenta/payment-proof-actions";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Fields";

const initialState: ProofState = { error: null, success: null };

export function PaymentProofForm({ tickets, defaultTicketId }: { tickets: Array<{ id: string; ticket_number: string; label?: string }>; defaultTicketId?: string }) {
  const [state, action, pending] = useActionState(uploadPaymentProof, initialState);
  const preset = tickets.some((ticket) => ticket.id === defaultTicketId) ? defaultTicketId : tickets.length === 1 ? tickets[0].id : "";
  return <form action={action} className="proof-form"><Select id="proof-ticket" name="ticketId" label="¿Qué compra pagaste?" required defaultValue={preset}><option value="">Selecciona tu compra</option>{tickets.map((ticket) => <option value={ticket.id} key={ticket.id}>{ticket.label ?? ticket.ticket_number}</option>)}</Select><Input id="proof-amount" name="amount" label="Monto que pagaste" type="number" min="0.01" step="0.01" inputMode="decimal" required/><Input id="proof-date" name="paidAt" label="Fecha de pago" type="date" required/><Select id="proof-method" name="method" label="Método" defaultValue="TRANSFER"><option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="PAYMENT_LINK">Link de pago</option></Select><Input id="proof-file" name="proof" label="Foto o PDF del comprobante" type="file" accept="image/jpeg,image/png,application/pdf" required/>{state.error && <p className="form-message form-error" role="alert">{state.error}</p>}{state.success && <p className="form-message form-success" role="status">{state.success}</p>}<Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar comprobante"}</Button></form>;
}
