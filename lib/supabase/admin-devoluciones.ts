import { decryptFromBytea } from "../crypto";
import { adminDb } from "./business";

// ---------------------------------------------------------------------------
// Devoluciones = refund_requests/refunds, part of database/schema.sql. The
// bank account fields (clabe_encrypted) need REFUND_ENCRYPTION_KEY in the
// environment (see lib/crypto.ts) — without it, decryption throws and this
// module reports the row as unreadable rather than crashing the whole page.
// ---------------------------------------------------------------------------

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type RefundRequestRow = {
  id: string;
  status: string;
  reason: string;
  requested_at: string;
  ticketId: string;
  ticketNumber: string;
  productName: string;
  agreedTotalCents: number;
  clientName: string;
  clientPhone: string;
  accountHolderName: string;
  bankName: string;
  clabe: string | null;
};

export async function listRefundRequests(includeClosed = false): Promise<RefundRequestRow[]> {
  let query = adminDb()
    .from("refund_requests")
    .select(
      "id, status, reason, requested_at, account_holder_first_name, account_holder_last_name, bank_name, clabe_encrypted, ticket_id, tickets(ticket_number, product_name_snapshot, agreed_total_cents, clients(first_name, last_name, phone))",
    );
  if (!includeClosed) query = query.in("status", ["REQUESTED", "IN_PROCESS"]);

  const { data, error } = await query.order("requested_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const ticket = relation(
      row.tickets as unknown as {
        ticket_number: string;
        product_name_snapshot: string;
        agreed_total_cents: number;
        clients: { first_name: string; last_name: string; phone: string } | { first_name: string; last_name: string; phone: string }[] | null;
      }[],
    );
    const client = ticket ? relation(ticket.clients) : null;

    let clabe: string | null = null;
    if (row.clabe_encrypted) {
      try {
        clabe = decryptFromBytea(row.clabe_encrypted as string);
      } catch {
        clabe = null;
      }
    }

    return {
      id: row.id as string,
      status: row.status as string,
      reason: row.reason as string,
      requested_at: row.requested_at as string,
      ticketId: row.ticket_id as string,
      ticketNumber: ticket?.ticket_number ?? "—",
      productName: ticket?.product_name_snapshot ?? "Producto eliminado",
      agreedTotalCents: Number(ticket?.agreed_total_cents ?? 0),
      clientName: client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada",
      clientPhone: client?.phone ?? "—",
      accountHolderName: `${row.account_holder_first_name} ${row.account_holder_last_name}`.trim(),
      bankName: row.bank_name as string,
      clabe,
    };
  });
}
