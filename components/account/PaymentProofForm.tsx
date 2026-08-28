"use client";

import { useActionState } from "react";
import { uploadPaymentProof, type ProofState } from "../../app/cuenta/payment-proof-actions";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Fields";

const initialState: ProofState = { error: null, success: null };

export function PaymentProofForm({ tickets }: { tickets: Array<{ id: string; ticket_number: string }> }) {
  const [state, action, pending] = useActionState(uploadPaymentProof, initialState);
  return <form action={action} className="proof-form"><Select id="proof-ticket" name="ticketId" label="Ticket" required><option value="">Selecciona un ticket</option>{tickets.map((ticket) => <option value={ticket.id} key={ticket.id}>{ticket.ticket_number}</option>)}</Select><Input id="proof-amount" name="amount" label="Monto reportado" type="number" min="0.01" step="0.01" required/><Input id="proof-date" name="paidAt" label="Fecha de pago" type="date" required/><Select id="proof-method" name="method" label="Método" defaultValue="TRANSFER"><option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="PAYMENT_LINK">Link de pago</option></Select><Input id="proof-file" name="proof" label="Comprobante" type="file" accept="image/jpeg,image/png,application/pdf" required/>{state.error && <p className="form-message form-error" role="alert">{state.error}</p>}{state.success && <p className="form-message form-success" role="status">{state.success}</p>}<Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar comprobante"}</Button></form>;
}
