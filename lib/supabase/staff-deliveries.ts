import { describeError } from "../actions";
import { businessToday } from "../format";
import { sendTelegramMessage } from "../telegram/send";
import { productImageUrl } from "./admin-catalog";
import { PAYMENT_PROOF_BUCKET } from "./admin-cobranza";
import { allocateCollection } from "./delivery-math";
import { adminDb, adminStorage, logActivity } from "./business";
import { getBookingRequestStates } from "./delivery-requests";
import { STAFF_DELIVERIES_UNAVAILABLE_MESSAGE, STAFF_SELECTS, isMissingStaffDeliverySchema } from "./staff-schema";

// ---------------------------------------------------------------------------
// Entregas programadas + Confirmar entrega, for the staff panel.
//
// A scheduled delivery is what the Agenda already stores: delivery_bookings in
// status BOOKED (one ticket per 10-minute slot, see lib/supabase/admin-agenda.ts).
// The panel groups the bookings of the same clienta, at the same place, on the
// same day into ONE delivery — that is how it happens at the door.
//
// Confirming writes everything in one transaction through
// confirm_staff_delivery() (database/migrations/013_staff_deliveries.sql).
// Every read uses STAFF_SELECTS: product, quantity, sale total and balance —
// never a cost.
// ---------------------------------------------------------------------------

export type DeliveryItem = {
  ticketId: string;
  bookingId: string;
  ticketNumber: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  imageUrl: string | null;
  agreedTotalCents: number;
  paidCents: number;
  balanceCents: number;
  paymentMode: string;
  financialStatus: string;
  /** Transfers already reported for this ticket and still waiting for the owner. */
  reportedPendingCents: number;
  /** False when the ticket left "Entrega programada" or was cancelled: it cannot be handed over. */
  deliverable: boolean;
  /** A client's request the owner has not confirmed yet (migration 020): never handed over. */
  pendingConfirmation: boolean;
};

const NOT_DELIVERABLE_FINANCIAL = new Set(["CANCELLED_INCIDENT", "REFUND_PENDING", "REFUNDED"]);

export type ScheduledDelivery = {
  /** Earliest booking of the group: the URL of the delivery. */
  id: string;
  day: string;
  startsAt: string;
  endsAt: string;
  deliveryTypes: string[];
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  locationName: string;
  locationAddress: string | null;
  items: DeliveryItem[];
  balanceCents: number;
  /** "Por confirmar por la dueña": shown, never delivered (migration 020). */
  pendingConfirmation: boolean;
};

type BookingRaw = {
  id: string;
  slot_id: string;
  ticket_id: string;
  client_id: string;
  delivery_type: string;
  status: string;
  delivery_slots: unknown;
};

type SlotInfo = { startsAt: string; endsAt: string; locationId: string; locationName: string; locationAddress: string | null };

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function slotOf(booking: BookingRaw): SlotInfo | null {
  const slot = first(booking.delivery_slots as { starts_at: string; ends_at: string; delivery_availabilities: unknown } | null);
  if (!slot) return null;
  const availability = first(slot.delivery_availabilities as { location_id: string; delivery_locations: unknown } | null);
  const location = first(availability?.delivery_locations as { id: string; name: string; address: string | null } | null);
  return {
    startsAt: slot.starts_at,
    endsAt: slot.ends_at,
    locationId: availability?.location_id ?? location?.id ?? "",
    locationName: location?.name ?? "Lugar sin nombre",
    locationAddress: location?.address ?? null,
  };
}

/** Business-local (America/Mazatlan) calendar day of an instant. */
export function businessDayOf(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(typeof value === "string" ? new Date(value) : value);
}

/** [from, to) of a business-local day, fixed UTC-7 like the Agenda (lib/supabase/admin-agenda.ts). */
export function businessDayRange(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: `${day}T00:00:00-07:00`, to: `${next.toISOString().slice(0, 10)}T00:00:00-07:00` };
}

const BOOKING_CAP = 500;

async function loadDeliveries(bookings: BookingRaw[]): Promise<ScheduledDelivery[]> {
  if (!bookings.length) return [];
  const db = adminDb();
  const ticketIds = [...new Set(bookings.map((booking) => booking.ticket_id))];
  const clientIds = [...new Set(bookings.map((booking) => booking.client_id))];
  const [ticketsResult, clientsResult, proofsResult, requestStates] = await Promise.all([
    db.from("tickets").select(STAFF_SELECTS.tickets).in("id", ticketIds),
    db.from("clients").select(STAFF_SELECTS.clients).in("id", clientIds),
    db.from("payment_proofs").select(STAFF_SELECTS.reportedProofs).in("ticket_id", ticketIds).eq("status", "PENDING"),
    // null without migration 020: every BOOKED row is a confirmed appointment.
    getBookingRequestStates(bookings.map((booking) => booking.id)),
  ]);
  const isPending = (bookingId: string) => requestStates?.get(bookingId)?.confirmedAt === null;
  if (ticketsResult.error) throw new Error(ticketsResult.error.message);
  if (clientsResult.error) throw new Error(clientsResult.error.message);

  const tickets = new Map(
    ((ticketsResult.data ?? []) as unknown as Array<Record<string, unknown>>).map((ticket) => [String(ticket.id), ticket]),
  );
  const clients = new Map(
    ((clientsResult.data ?? []) as Array<{ id: string; first_name: string; last_name: string; phone: string | null }>).map((client) => [client.id, client]),
  );
  const reported = new Map<string, number>();
  for (const proof of (proofsResult.data ?? []) as Array<{ ticket_id: string; reported_amount_cents: number }>) {
    reported.set(proof.ticket_id, (reported.get(proof.ticket_id) ?? 0) + Number(proof.reported_amount_cents ?? 0));
  }

  const groups = new Map<string, ScheduledDelivery>();
  const sorted = [...bookings]
    .map((booking) => ({ booking, slot: slotOf(booking) }))
    .filter((entry): entry is { booking: BookingRaw; slot: SlotInfo } => Boolean(entry.slot))
    .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt));

  for (const { booking, slot } of sorted) {
    const ticket = tickets.get(booking.ticket_id);
    if (!ticket) continue;
    const day = businessDayOf(slot.startsAt);
    const pending = isPending(booking.id);
    const key = `${booking.client_id}|${slot.locationId}|${day}|${pending ? "pending" : "confirmed"}`;
    let group = groups.get(key);
    if (!group) {
      const client = clients.get(booking.client_id);
      group = {
        id: booking.id,
        day,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        deliveryTypes: [],
        clientId: booking.client_id,
        clientName: client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada",
        clientPhone: client?.phone ?? null,
        locationName: slot.locationName,
        locationAddress: slot.locationAddress,
        items: [],
        balanceCents: 0,
        pendingConfirmation: pending,
      };
      groups.set(key, group);
    }
    if (slot.endsAt > group.endsAt) group.endsAt = slot.endsAt;
    if (!group.deliveryTypes.includes(booking.delivery_type)) group.deliveryTypes.push(booking.delivery_type);
    const agreed = Number(ticket.agreed_total_cents ?? 0);
    const paid = Number(ticket.paid_principal_cents ?? 0);
    const balance = Math.max(agreed - paid, 0);
    group.items.push({
      ticketId: String(ticket.id),
      bookingId: booking.id,
      ticketNumber: String(ticket.ticket_number),
      productName: String(ticket.product_name_snapshot ?? "Producto"),
      variantName: (ticket.variant_name_snapshot as string | null) ?? null,
      quantity: Number(ticket.quantity ?? 1),
      imageUrl: productImageUrl(ticket.image_storage_key_snapshot as string | null),
      agreedTotalCents: agreed,
      paidCents: paid,
      balanceCents: balance,
      paymentMode: String(ticket.payment_mode ?? "FULL"),
      financialStatus: String(ticket.financial_status ?? ""),
      reportedPendingCents: reported.get(String(ticket.id)) ?? 0,
      deliverable:
        !pending && ticket.logistics_status === "DELIVERY_SCHEDULED" && !NOT_DELIVERABLE_FINANCIAL.has(String(ticket.financial_status ?? "")),
      pendingConfirmation: pending,
    });
    group.balanceCents += balance;
  }

  for (const group of groups.values()) group.items.sort((a, b) => (a.ticketNumber < b.ticketNumber ? -1 : a.ticketNumber > b.ticketNumber ? 1 : 0));
  return [...groups.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Scheduled (BOOKED) deliveries. `day` = one business day; without it, every
 * pending one (earlier days still pending included, so nothing is forgotten).
 * `search` matches the clienta's name or phone.
 */
export async function listScheduledDeliveries(query: { day?: string | null; search?: string } = {}) {
  const { data, error } = await adminDb()
    .from("delivery_bookings")
    .select(STAFF_SELECTS.bookings)
    .eq("status", "BOOKED")
    .limit(BOOKING_CAP);
  if (error) throw new Error(error.message);
  let deliveries = await loadDeliveries((data ?? []) as unknown as BookingRaw[]);
  if (query.day) deliveries = deliveries.filter((delivery) => delivery.day === query.day);
  const term = (query.search ?? "").trim().toLowerCase();
  if (term) {
    const digits = term.replace(/\D/g, "");
    deliveries = deliveries.filter(
      (delivery) =>
        delivery.clientName.toLowerCase().includes(term) || (digits.length >= 3 && (delivery.clientPhone ?? "").includes(digits)),
    );
  }
  return { deliveries, today: businessToday(), capped: (data ?? []).length >= BOOKING_CAP };
}

export type DeliveryReceipt = {
  id: string;
  deliveredAt: string;
  deliveredBy: string;
  receivedBy: "CLIENT" | "OTHER";
  receiverName: string | null;
  receiverRelationship: string | null;
  paymentMethod: "CASH" | "TRANSFER" | null;
  amountCollectedCents: number;
  paymentReference: string | null;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  notes: string | null;
  /** Transfers: PENDING (reportada) / APPROVED (confirmada) / REJECTED, from the proofs it created. */
  transferStatus: "REPORTED" | "CONFIRMED" | "REJECTED" | null;
  ticketNumbers: string[];
};

/**
 * One delivery, by the id of any of its bookings. While it is pending, the
 * group is rebuilt from the bookings that are still BOOKED; once confirmed,
 * `receipt` describes what was saved.
 */
export async function getDeliveryDetail(bookingId: string): Promise<{
  delivery: ScheduledDelivery | null;
  receipt: DeliveryReceipt | null;
  confirmAvailable: boolean;
} | null> {
  const db = adminDb();
  const { data: anchor, error } = await db.from("delivery_bookings").select(STAFF_SELECTS.bookings).eq("id", bookingId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!anchor) return null;
  const booking = anchor as unknown as BookingRaw;
  const slot = slotOf(booking);
  const confirmAvailable = await isDeliveryConfirmationAvailable();

  if (booking.status !== "BOOKED") {
    const receipt = confirmAvailable ? await getReceiptForTicket(booking.ticket_id) : null;
    return { delivery: null, receipt, confirmAvailable };
  }
  if (!slot) return null;

  const day = businessDayOf(slot.startsAt);
  const { data: siblings, error: siblingsError } = await db
    .from("delivery_bookings")
    .select(STAFF_SELECTS.bookings)
    .eq("status", "BOOKED")
    .eq("client_id", booking.client_id)
    .limit(100);
  if (siblingsError) throw new Error(siblingsError.message);
  const sameDelivery = ((siblings ?? []) as unknown as BookingRaw[]).filter((candidate) => {
    const candidateSlot = slotOf(candidate);
    return candidateSlot && candidateSlot.locationId === slot.locationId && businessDayOf(candidateSlot.startsAt) === day;
  });
  // Confirmed and still-pending bookings of the same day form separate groups: take the anchor's.
  const groups = await loadDeliveries(sameDelivery);
  const delivery = groups.find((group) => group.items.some((item) => item.bookingId === bookingId)) ?? null;
  return { delivery: delivery ? { ...delivery, id: bookingId } : null, receipt: null, confirmAvailable };
}

/** Whether migration 013 is applied (the confirmations table answers). */
export async function isDeliveryConfirmationAvailable() {
  const { error } = await adminDb().from("delivery_confirmations").select("id").limit(1);
  if (!error) return true;
  if (isMissingStaffDeliverySchema(error.message)) return false;
  throw new Error(error.message);
}

async function getReceiptForTicket(ticketId: string): Promise<DeliveryReceipt | null> {
  const db = adminDb();
  const { data: item } = await db.from("delivery_confirmation_items").select(STAFF_SELECTS.confirmationItems).eq("ticket_id", ticketId).maybeSingle();
  if (!item) return null;
  return getReceipt(String((item as { confirmation_id: string }).confirmation_id));
}

export async function getReceipt(confirmationId: string): Promise<DeliveryReceipt | null> {
  const db = adminDb();
  const { data, error } = await db.from("delivery_confirmations").select(STAFF_SELECTS.confirmations).eq("id", confirmationId).maybeSingle();
  if (error) {
    if (isMissingStaffDeliverySchema(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const [itemsResult, namesResult] = await Promise.all([
    db.from("delivery_confirmation_items").select(STAFF_SELECTS.confirmationItems).eq("confirmation_id", confirmationId),
    db.from("admin_users").select(STAFF_SELECTS.staffNames).eq("id", String(row.delivered_by_admin_id)),
  ]);
  const items = (itemsResult.data ?? []) as Array<{ ticket_id: string; payment_proof_id: string | null }>;
  const ticketIds = items.map((item) => item.ticket_id);
  const proofIds = items.map((item) => item.payment_proof_id).filter((id): id is string => Boolean(id));
  const [ticketsResult, proofsResult] = await Promise.all([
    ticketIds.length ? db.from("tickets").select(STAFF_SELECTS.ticketNumbers).in("id", ticketIds) : Promise.resolve({ data: [] }),
    proofIds.length ? db.from("payment_proofs").select(STAFF_SELECTS.reportedProofs).in("id", proofIds) : Promise.resolve({ data: [] }),
  ]);
  const proofStatuses = ((proofsResult.data ?? []) as Array<{ status: string }>).map((proof) => proof.status);
  const transferStatus =
    row.payment_method !== "TRANSFER"
      ? null
      : proofStatuses.some((status) => status === "REJECTED")
        ? "REJECTED"
        : proofStatuses.length && proofStatuses.every((status) => status === "APPROVED")
          ? "CONFIRMED"
          : "REPORTED";
  return {
    id: String(row.id),
    deliveredAt: String(row.delivered_at),
    deliveredBy: ((namesResult.data ?? []) as Array<{ display_name: string }>)[0]?.display_name ?? "—",
    receivedBy: row.received_by === "OTHER" ? "OTHER" : "CLIENT",
    receiverName: (row.receiver_name as string | null) ?? null,
    receiverRelationship: (row.receiver_relationship as string | null) ?? null,
    paymentMethod: row.payment_method === "CASH" || row.payment_method === "TRANSFER" ? row.payment_method : null,
    amountCollectedCents: Number(row.amount_collected_cents ?? 0),
    paymentReference: (row.payment_reference as string | null) ?? null,
    balanceBeforeCents: Number(row.balance_before_cents ?? 0),
    balanceAfterCents: Number(row.balance_after_cents ?? 0),
    notes: (row.notes as string | null) ?? null,
    transferStatus,
    ticketNumbers: ((ticketsResult.data ?? []) as Array<{ ticket_number: string }>).map((ticket) => ticket.ticket_number).sort(),
  };
}

// ---------------------------------------------------------------------------
// Confirmar entrega
// ---------------------------------------------------------------------------

export type ConfirmDeliveryInput = {
  adminId: string;
  bookingId: string;
  /** Tickets handed over, each with the balance the employee saw on screen. */
  tickets: Array<{ ticketId: string; balanceCents: number }>;
  method: "CASH" | "TRANSFER" | null;
  amountCents: number;
  reference: string;
  receivedBy: "CLIENT" | "OTHER";
  receiverName: string;
  receiverRelationship: string;
  balanceAcknowledged: boolean;
  notes: string;
  proofPhoto?: File | null;
};

export type ConfirmDeliveryResult = { ok: true; confirmationId: string; message: string } | { ok: false; error: string };

const PROOF_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };
const MAX_PROOF_BYTES = 1024 * 1024;

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

/** Readable message for a database error raised by confirm_staff_delivery(). */
function describeConfirmError(message: string) {
  if (isMissingStaffDeliverySchema(message)) return STAFF_DELIVERIES_UNAVAILABLE_MESSAGE;
  const cents = message.match(/importe cobrado \((\d+) centavos\).*saldo pendiente de lo que se entrega \((\d+) centavos\)/);
  if (cents) return `El importe cobrado (${money(Number(cents[1]))}) es mayor que el saldo pendiente de lo que se entrega (${money(Number(cents[2]))}).`;
  if (message.includes("uq_delivery_confirmation_items_ticket")) return "Uno de estos artículos ya fue entregado. Recarga la entrega.";
  if (/permission denied for table (payments|payment_allocations|payment_proofs)/.test(message)) {
    return "No se guardó nada: la base de datos todavía no permite registrar cobros (falta el permiso de service_role sobre luxury_finds.payments; lo da 013_staff_deliveries.sql o un GRANT de la dueña). Puedes confirmar la entrega sin cobro mientras tanto.";
  }
  return describeError(new Error(message), "No fue posible confirmar la entrega.");
}

/**
 * Validates, uploads the transfer receipt photo (one copy per ticket that
 * receives part of the transfer: payment_proofs.storage_key is unique), and
 * calls confirm_staff_delivery(). If the database refuses, the uploaded copies
 * are removed and nothing else was written.
 */
export async function confirmStaffDelivery(input: ConfirmDeliveryInput): Promise<ConfirmDeliveryResult> {
  const detail = await getDeliveryDetail(input.bookingId);
  if (!detail) return { ok: false, error: "Esa entrega ya no existe." };
  if (!detail.confirmAvailable) return { ok: false, error: STAFF_DELIVERIES_UNAVAILABLE_MESSAGE };
  const delivery = detail.delivery;
  if (!delivery) return { ok: false, error: "Esta entrega ya fue confirmada o cancelada. Recarga la lista." };

  if (!input.tickets.length) return { ok: false, error: "Selecciona al menos un artículo entregado." };
  const byTicket = new Map(delivery.items.map((item) => [item.ticketId, item]));
  const selected = [];
  for (const ticket of input.tickets) {
    const item = byTicket.get(ticket.ticketId);
    if (!item) return { ok: false, error: "Uno de los artículos ya no pertenece a esta entrega. Recarga la entrega." };
    if (item.pendingConfirmation) return { ok: false, error: `La cita del ticket ${item.ticketNumber} está por confirmar por la dueña: todavía no se entrega.` };
    if (!item.deliverable) return { ok: false, error: `El ticket ${item.ticketNumber} ya no está listo para entregarse.` };
    if (!Number.isInteger(ticket.balanceCents) || ticket.balanceCents < 0) return { ok: false, error: "Saldo no válido. Recarga la entrega." };
    selected.push({ ...item, balanceCents: ticket.balanceCents });
  }
  if (new Set(selected.map((item) => item.ticketId)).size !== selected.length) return { ok: false, error: "Un artículo viene repetido." };

  const amount = input.amountCents;
  if (!Number.isInteger(amount)) return { ok: false, error: "Escribe un importe válido." };
  if (amount < 0) return { ok: false, error: "El importe cobrado no puede ser negativo." };
  const balance = selected.reduce((sum, item) => sum + item.balanceCents, 0);
  if (amount > balance) {
    return { ok: false, error: `El importe cobrado (${money(amount)}) es mayor que el saldo pendiente de lo que se entrega (${money(balance)}).` };
  }
  const method = amount > 0 ? input.method : null;
  if (amount > 0 && method !== "CASH" && method !== "TRANSFER") return { ok: false, error: "Elige cómo pagó: efectivo o transferencia." };
  if (balance - amount > 0 && !input.balanceAcknowledged) {
    return { ok: false, error: `Queda un saldo pendiente de ${money(balance - amount)}: confírmalo explícitamente para entregar.` };
  }
  if (amount === 0 && balance > 0 && !input.notes.trim()) return { ok: false, error: "No se registró ningún cobro: escribe una nota con el motivo." };
  if (input.receivedBy !== "CLIENT" && input.receivedBy !== "OTHER") return { ok: false, error: "Indica quién recibió." };
  if (input.receivedBy === "OTHER" && (!input.receiverName.trim() || !input.receiverRelationship.trim())) {
    return { ok: false, error: "Si recibió otra persona, escribe su nombre y su relación con la clienta." };
  }

  const photo = method === "TRANSFER" ? (input.proofPhoto ?? null) : null;
  if (photo) {
    if (!PROOF_EXTENSIONS[photo.type]) return { ok: false, error: "El comprobante debe ser una foto JPG o PNG." };
    if (photo.size > MAX_PROOF_BYTES) return { ok: false, error: "La foto del comprobante pesa demasiado. Tómala desde el panel (se reduce sola)." };
  }

  const shares = allocateCollection(selected, amount);
  const uploaded: string[] = [];
  const keyByTicket = new Map<string, string>();
  if (photo) {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const batch = crypto.randomUUID();
    for (const share of shares.filter((entry) => entry.shareCents > 0)) {
      const key = `staff/${input.adminId}/${batch}-${share.ticketNumber}.${PROOF_EXTENSIONS[photo.type]}`;
      const { error } = await adminStorage().from(PAYMENT_PROOF_BUCKET).upload(key, bytes, { contentType: photo.type, upsert: false });
      if (error) {
        if (uploaded.length) await adminStorage().from(PAYMENT_PROOF_BUCKET).remove(uploaded).catch(() => {});
        return { ok: false, error: `No fue posible subir el comprobante: ${error.message}` };
      }
      uploaded.push(key);
      keyByTicket.set(share.ticketId, key);
    }
  }

  const payload = {
    client_id: delivery.clientId,
    received_by: input.receivedBy,
    receiver_name: input.receivedBy === "OTHER" ? input.receiverName.trim().slice(0, 120) : null,
    receiver_relationship: input.receivedBy === "OTHER" ? input.receiverRelationship.trim().slice(0, 80) : null,
    payment_method: method,
    amount_cents: amount,
    reference: input.reference.trim().slice(0, 120) || null,
    proof_mime_type: photo ? photo.type : null,
    balance_acknowledged: input.balanceAcknowledged,
    notes: input.notes.trim().slice(0, 500) || null,
    tickets: selected.map((item) => ({ id: item.ticketId, balance_cents: item.balanceCents, proof_storage_key: keyByTicket.get(item.ticketId) ?? null })),
  };

  const { data, error } = await adminDb().rpc("confirm_staff_delivery", { p_admin_id: input.adminId, p_payload: payload });
  if (error) {
    if (uploaded.length) await adminStorage().from(PAYMENT_PROOF_BUCKET).remove(uploaded).catch(() => {});
    return { ok: false, error: describeConfirmError(error.message) };
  }
  const confirmationId = String(data);

  await notifyDelivered(delivery.clientId, selected.map((item) => item.ticketNumber));
  await logActivity({
    adminUserId: input.adminId,
    action: "DELIVERY_CONFIRMED",
    entityType: "delivery_confirmations",
    entityId: confirmationId,
    newData: {
      tickets: selected.map((item) => item.ticketNumber),
      receivedBy: input.receivedBy,
      method,
      amountCents: amount,
      balanceBeforeCents: balance,
      balanceAfterCents: balance - amount,
      transferPhoto: Boolean(photo),
    },
  });

  const collected =
    amount === 0 ? "Sin cobro." : method === "CASH" ? `Cobro en efectivo: ${money(amount)} (en tu caja).` : `Transferencia de ${money(amount)} reportada: queda pendiente de que la dueña la valide.`;
  const pending = balance - amount > 0 ? ` Queda saldo pendiente de ${money(balance - amount)}.` : "";
  return { ok: true, confirmationId, message: `Entrega confirmada. ${collected}${pending}` };
}

/** Same in-app + Telegram notice the Agenda's "Completar" sends. Best-effort. */
async function notifyDelivered(clientId: string, ticketNumbers: string[]) {
  const db = adminDb();
  const list = ticketNumbers.join(", ");
  try {
    await db.from("notifications").insert(
      ticketNumbers.map((number) => ({
        client_id: clientId,
        type: "GENERAL",
        title: "Entrega completada",
        body: `Tu ticket ${number} fue entregado. ¡Gracias por tu compra!`,
      })),
    );
  } catch {
    // Best-effort.
  }
  try {
    const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", clientId).maybeSingle();
    if (client?.telegram_chat_id) await sendTelegramMessage(client.telegram_chat_id, `✅ <b>Entrega completada</b>\nTicket(s): ${list}`);
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Mi caja de hoy (the employee) — the owner's view is lib/supabase/admin-employees.ts
// ---------------------------------------------------------------------------

export type StaffCashSummary = {
  available: boolean;
  day: string;
  cashCents: number;
  cashCount: number;
  transferReportedCents: number;
  transferCount: number;
  deliveries: Array<{ id: string; deliveredAt: string; clientName: string; method: string | null; amountCents: number; balanceAfterCents: number }>;
};

export async function getStaffCashForDay(adminId: string, day = businessToday()): Promise<StaffCashSummary> {
  const empty: StaffCashSummary = { available: true, day, cashCents: 0, cashCount: 0, transferReportedCents: 0, transferCount: 0, deliveries: [] };
  const { from, to } = businessDayRange(day);
  const db = adminDb();
  const { data, error } = await db
    .from("delivery_confirmations")
    .select(STAFF_SELECTS.confirmations)
    .eq("delivered_by_admin_id", adminId)
    .gte("delivered_at", from)
    .lt("delivered_at", to)
    .order("delivered_at", { ascending: false });
  if (error) {
    if (isMissingStaffDeliverySchema(error.message)) return { ...empty, available: false };
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const clientIds = [...new Set(rows.map((row) => String(row.client_id)))];
  const { data: clients } = clientIds.length ? await db.from("clients").select(STAFF_SELECTS.clients).in("id", clientIds) : { data: [] };
  const names = new Map(((clients ?? []) as Array<{ id: string; first_name: string; last_name: string }>).map((client) => [client.id, `${client.first_name} ${client.last_name}`.trim()]));
  const summary = { ...empty };
  for (const row of rows) {
    const amount = Number(row.amount_collected_cents ?? 0);
    if (row.payment_method === "CASH") {
      summary.cashCents += amount;
      summary.cashCount += 1;
    } else if (row.payment_method === "TRANSFER") {
      summary.transferReportedCents += amount;
      summary.transferCount += 1;
    }
    summary.deliveries.push({
      id: String(row.id),
      deliveredAt: String(row.delivered_at),
      clientName: names.get(String(row.client_id)) ?? "Clienta",
      method: (row.payment_method as string | null) ?? null,
      amountCents: amount,
      balanceAfterCents: Number(row.balance_after_cents ?? 0),
    });
  }
  return summary;
}
