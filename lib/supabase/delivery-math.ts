/**
 * How what is collected at a delivery is split across the delivered tickets:
 * ticket_number order (byte order — confirm_staff_delivery() sorts with
 * COLLATE "C"; ticket numbers are plain ASCII), each ticket up to its balance.
 * Shared by the confirmation screen (preview) and the server (to know which
 * tickets get a copy of the transfer receipt). Free of any Supabase import.
 */
export function allocateCollection<T extends { ticketId: string; ticketNumber: string; balanceCents: number }>(items: T[], amountCents: number) {
  let remaining = Math.max(0, Math.trunc(amountCents));
  return [...items]
    .sort((a, b) => (a.ticketNumber < b.ticketNumber ? -1 : a.ticketNumber > b.ticketNumber ? 1 : 0))
    .map((item) => {
      const share = Math.min(remaining, Math.max(item.balanceCents, 0));
      remaining -= share;
      return { ticketId: item.ticketId, ticketNumber: item.ticketNumber, shareCents: share };
    });
}
