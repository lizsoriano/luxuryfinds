import { adminDb, adminStorage } from "./business";
import { isMissingStaffDeliverySchema } from "./staff-schema";

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
  /** NULL only for a transfer reported by staff without a photo (migration 013). */
  storage_key: string | null;
  mime_type: string | null;
  reported_amount_cents: number;
  effective_paid_at: string;
  payment_method: string;
  uploaded_at: string;
  ticketNumber: string;
  productName: string;
  variantName: string | null;
  clientName: string;
  clientPhone: string;
  /** Employee who reported the transfer at a delivery (staff panel); null for a clienta's upload. */
  reportedBy: string | null;
  /** Bank reference typed by the employee (migration 013). */
  reference: string | null;
};

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const PENDING_PROOF_COLUMNS =
  "id, ticket_id, storage_key, mime_type, reported_amount_cents, effective_paid_at, payment_method, uploaded_at, uploaded_by_admin_id, tickets(ticket_number, product_name_snapshot, variant_name_snapshot, clients(first_name, last_name, phone))";

export async function listPendingProofs(): Promise<PendingProofRow[]> {
  // `reference` arrives with migration 013; until then the same read runs without it.
  const read = (withReference: boolean) =>
    adminDb()
      .from("payment_proofs")
      .select(withReference ? `${PENDING_PROOF_COLUMNS}, reference` : PENDING_PROOF_COLUMNS)
      .eq("status", "PENDING")
      .order("uploaded_at", { ascending: true });
  let result = await read(true);
  if (result.error && isMissingStaffDeliverySchema(result.error.message)) result = await read(false);
  const { data, error } = result;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const reporterIds = [...new Set(rows.map((row) => row.uploaded_by_admin_id).filter((id): id is string => typeof id === "string"))];
  const reporters = new Map<string, string>();
  if (reporterIds.length) {
    const { data: admins } = await adminDb().from("admin_users").select("id, display_name").in("id", reporterIds);
    for (const admin of (admins ?? []) as Array<{ id: string; display_name: string }>) reporters.set(admin.id, admin.display_name);
  }

  return rows.map((row) => {
    const ticket = relation(
      row.tickets as unknown as {
        ticket_number: string;
        product_name_snapshot: string;
        variant_name_snapshot: string | null;
        clients: { first_name: string; last_name: string; phone: string } | { first_name: string; last_name: string; phone: string }[] | null;
      }[],
    );
    const client = ticket ? relation(ticket.clients) : null;
    const reporterId = typeof row.uploaded_by_admin_id === "string" ? row.uploaded_by_admin_id : null;
    return {
      id: row.id as string,
      ticket_id: row.ticket_id as string,
      storage_key: (row.storage_key as string | null) ?? null,
      mime_type: (row.mime_type as string | null) ?? null,
      reported_amount_cents: Number(row.reported_amount_cents),
      effective_paid_at: row.effective_paid_at as string,
      payment_method: row.payment_method as string,
      uploaded_at: row.uploaded_at as string,
      ticketNumber: ticket?.ticket_number ?? "—",
      productName: ticket?.product_name_snapshot ?? "Producto eliminado",
      variantName: ticket?.variant_name_snapshot ?? null,
      clientName: client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada",
      clientPhone: client?.phone ?? "—",
      reportedBy: reporterId ? (reporters.get(reporterId) ?? "Empleado") : null,
      reference: (row.reference as string | null | undefined) ?? null,
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
export async function getSignedProofUrl(storageKey: string | null): Promise<string | null> {
  if (!storageKey) return null;
  const { data, error } = await adminStorage().from(PAYMENT_PROOF_BUCKET).createSignedUrl(storageKey, 300);
  if (error) return null;
  return data.signedUrl;
}
