import { adminDb, adminStorage } from "./business";

// ---------------------------------------------------------------------------
// Cobranza = reviewing payment_proofs clients upload from /cuenta (see
// app/cuenta/payment-proof-actions.ts, built before this file and already
// live) and turning an approved one into a real payments/payment_allocations
// entry against the ticket's installments. None of payments/payment_allocations/
// payment_proofs depend on migrations 002/003/004 — they are part of the base
// database/schema.sql, just never exercised until now because nothing ever
// generated a ticket before app/admin/pedidos/actions.ts.
// ---------------------------------------------------------------------------

export const PAYMENT_PROOF_BUCKET = "payment-proofs";

export type PendingProofRow = {
  id: string;
  ticket_id: string;
  storage_key: string;
  mime_type: string;
  reported_amount_cents: number;
  effective_paid_at: string;
  payment_method: string;
  uploaded_at: string;
  ticketNumber: string;
  productName: string;
  variantName: string | null;
  clientName: string;
  clientPhone: string;
};

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function listPendingProofs(): Promise<PendingProofRow[]> {
  const { data, error } = await adminDb()
    .from("payment_proofs")
    .select(
      "id, ticket_id, storage_key, mime_type, reported_amount_cents, effective_paid_at, payment_method, uploaded_at, tickets(ticket_number, product_name_snapshot, variant_name_snapshot, clients(first_name, last_name, phone))",
    )
    .eq("status", "PENDING")
    .order("uploaded_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const ticket = relation(
      row.tickets as unknown as {
        ticket_number: string;
        product_name_snapshot: string;
        variant_name_snapshot: string | null;
        clients: { first_name: string; last_name: string; phone: string } | { first_name: string; last_name: string; phone: string }[] | null;
      }[],
    );
    const client = ticket ? relation(ticket.clients) : null;
    return {
      id: row.id as string,
      ticket_id: row.ticket_id as string,
      storage_key: row.storage_key as string,
      mime_type: row.mime_type as string,
      reported_amount_cents: Number(row.reported_amount_cents),
      effective_paid_at: row.effective_paid_at as string,
      payment_method: row.payment_method as string,
      uploaded_at: row.uploaded_at as string,
      ticketNumber: ticket?.ticket_number ?? "—",
      productName: ticket?.product_name_snapshot ?? "Producto eliminado",
      variantName: ticket?.variant_name_snapshot ?? null,
      clientName: client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada",
      clientPhone: client?.phone ?? "—",
    };
  });
}

export type ProofDecisionRow = {
  id: string;
  status: string;
  reported_amount_cents: number;
  rejection_reason: string | null;
  validated_at: string | null;
  ticketNumber: string;
  productName: string;
};

export async function listRecentProofDecisions(limit = 20): Promise<ProofDecisionRow[]> {
  const { data, error } = await adminDb()
    .from("payment_proofs")
    .select("id, status, reported_amount_cents, rejection_reason, validated_at, tickets(ticket_number, product_name_snapshot)")
    .neq("status", "PENDING")
    .order("validated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const ticket = relation(row.tickets as unknown as { ticket_number: string; product_name_snapshot: string }[]);
    return {
      id: row.id as string,
      status: row.status as string,
      reported_amount_cents: Number(row.reported_amount_cents),
      rejection_reason: row.rejection_reason as string | null,
      validated_at: row.validated_at as string | null,
      ticketNumber: ticket?.ticket_number ?? "—",
      productName: ticket?.product_name_snapshot ?? "Producto eliminado",
    };
  });
}

/** Private bucket: every view goes through a short-lived signed URL, never a public one. */
export async function getSignedProofUrl(storageKey: string): Promise<string | null> {
  const { data, error } = await adminStorage().from(PAYMENT_PROOF_BUCKET).createSignedUrl(storageKey, 300);
  if (error) return null;
  return data.signedUrl;
}
