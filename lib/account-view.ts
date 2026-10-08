// Pure rules of the client's panel (/cuenta): how her purchases, payments,
// deliveries and "what to do next" read. No Supabase import, so the same code
// runs in the server pages, in client components (the delivery scheduler) and
// in the PGlite/Node checks. lib/supabase/account.ts does the scoped reads and
// hands the raw rows here.

import { LOGISTICS_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "./format";

export const BUSINESS_TZ = "America/Mazatlan";
export const CLIENT_CHANGE_RULE = "Puedes cambiar o cancelar tu cita hasta un día antes. El mismo día, escríbenos.";
/** The owner's policy (Cómo comprar §5): one natural month to pick up once she is told it is ready. */
export const PICKUP_REMINDER = "Recuerda: tienes un mes para recogerlo desde que te avisamos que está listo.";

// ---------------------------------------------------------------------------
// Raw rows (only the columns lib/supabase/account.ts selects — never costs,
// commissions, internal notes or shopper data).
// ---------------------------------------------------------------------------

export type RawOrder = { id: string; status: string; created_at: string; confirmed_at: string | null; cancelled_at: string | null; origin: string };
export type RawOrderItem = { id: string; order_id: string; product_id: string | null; quantity: number; unit_price_cents: number; products?: { name: string } | null; product_variants?: { name: string } | null };
export type RawTicket = {
  id: string; order_item_id: string; ticket_number: string; product_id: string | null;
  product_name_snapshot: string; variant_name_snapshot: string | null; image_storage_key_snapshot: string | null;
  quantity: number; cash_unit_price_cents: number; agreed_total_cents: number; discount_cents: number;
  payment_mode: string; financial_status: string; logistics_status: string; paid_principal_cents: number;
  incident_reason: string | null; created_at: string; updated_at: string;
};
export type RawSale = { id: string; sale_number: string; status: string; sold_at: string; subtotal_cents: number; discount_cents: number; total_cents: number; payment_method: string; sale_type: string; concept: string | null };
export type RawSaleItem = { id: string; sale_id: string; product_id: string | null; product_name_snapshot: string; variant_name_snapshot: string | null; quantity: number; unit_price_cents: number; total_cents: number; unit_label: string | null };
export type RawFulfillment = { id: string; logistics_status: string; updated_at: string };
export type RawPlan = { id: string; ticket_id: string; mode: string; status: string; agreed_total_cents: number; number_of_weeks: number | null; start_date: string; due_date: string | null };
export type RawInstallment = { id: string; payment_plan_id: string; installment_number: number; due_at: string; amount_cents: number; paid_cents: number; status: string };
export type RawFee = { id: string; ticket_id: string; amount_cents: number; paid_cents: number; status: string };
export type RawPayment = { id: string; ticket_id: string; amount_cents: number; method: string; effective_paid_at: string };
export type RawProof = { id: string; ticket_id: string; reported_amount_cents: number; payment_method: string; status: string; rejection_reason: string | null; uploaded_at: string };
export type RawBooking = { id: string; ticket_id: string; slot_id: string; delivery_type: string; status: string; booked_at: string; cancellation_reason: string | null };
export type RawSlotInfo = { id: string; starts_at: string; ends_at: string; location_name: string; location_address: string };
export type RawNotification = { id: string; ticket_id: string | null; type: string; title: string; body: string; read_at: string | null; created_at: string };
export type RawReservation = { id: string; ticket_id: string; status: string; expires_at: string };

export type AccountRaw = {
  orders: RawOrder[]; orderItems: RawOrderItem[]; tickets: RawTicket[];
  sales: RawSale[]; saleItems: RawSaleItem[]; fulfillment: RawFulfillment[];
  plans: RawPlan[]; installments: RawInstallment[]; fees: RawFee[];
  payments: RawPayment[]; proofs: RawProof[]; bookings: RawBooking[]; slots: RawSlotInfo[];
  notifications: RawNotification[]; reservations: RawReservation[];
  /** ticket id -> estimated arrival (YYYY-MM-DD) of the shipment it travels in. */
  etaByTicket: Record<string, string>;
  /** product id -> first catalogue image key. */
  imageByProduct: Record<string, string>;
};

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type LineStatus = string; // a logistics_status, or PENDING_CONFIRMATION / CANCELLED
export type BadgeTone = "neutral" | "rose" | "success" | "warning" | "danger";

export type AccountBooking = {
  id: string; ticketId: string; status: string; deliveryType: string; bookedAt: string; cancellationReason: string | null;
  startsAt: string | null; endsAt: string | null; locationName: string | null; locationAddress: string | null;
};

export type AccountLine = {
  key: string;
  source: "TICKET" | "SALE_ITEM" | "ORDER_ITEM";
  ticketId: string | null;
  ticketNumber: string | null;
  name: string;
  variant: string | null;
  quantity: number;
  unitLabel: string | null;
  imageUrl: string | null;
  status: LineStatus;
  statusUpdatedAt: string | null;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  financialStatus: string | null;
  hasIncident: boolean;
  eta: string | null;
  booking: AccountBooking | null;
  /** A ticket in READY_FOR_DELIVERY without an active appointment: she can book it herself. */
  canSchedule: boolean;
  /** A counter-sale item ready in La Paz: delivery_bookings only holds tickets, so it is coordinated by message. */
  scheduleByMessage: boolean;
  reservation: { status: string; expiresAt: string } | null;
  planId: string | null;
};

export type AccountPayment = { id: string; ticketId: string | null; amountCents: number; method: string; methodLabel: string; paidAt: string };
export type AccountProof = { id: string; ticketId: string; amountCents: number; methodLabel: string; status: string; statusLabel: string; tone: BadgeTone; rejectionReason: string | null; uploadedAt: string };

export type PurchaseState = "PENDING" | "ACTIVE" | "DELIVERED" | "CANCELLED";
export type AccountPurchase = {
  key: string; // p-<orderId> | s-<saleId>
  kind: "ORDER" | "SALE";
  reference: string;
  channel: string;
  createdAt: string;
  lines: AccountLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  state: PurchaseState;
  payments: AccountPayment[];
  proofs: AccountProof[];
};

export type AccountInstallment = { id: string; number: number; dueAt: string; amountCents: number; paidCents: number; pendingCents: number; status: "PAID" | "PARTIAL" | "PENDING" | "OVERDUE" };
export type AccountPlan = { id: string; ticketId: string; ticketNumber: string; productName: string; imageUrl: string | null; purchaseKey: string | null; status: string; modeLabel: string; weeks: number | null; installments: AccountInstallment[]; paidCount: number; progress: number };

export type AccountAppointment = {
  key: string; bookingIds: string[]; ticketIds: string[]; startsAt: string; endsAt: string;
  locationName: string; locationAddress: string; deliveryType: string;
  lines: Array<{ name: string; imageUrl: string | null; ticketNumber: string | null; balanceCents: number }>;
  canChange: boolean;
};

export type AccountMoney = {
  totalCents: number; paidCents: number; owedCents: number; lateFeesCents: number;
  nextDue: { amountCents: number; dueAt: string; overdue: boolean } | null;
};

export type AccountAction = { tone: "urgent" | "ready" | "info" | "ok"; title: string; body: string; href: string; cta: string };

export type AccountOverview = {
  purchases: AccountPurchase[];
  plans: AccountPlan[];
  appointments: AccountAppointment[];
  money: AccountMoney;
  notifications: RawNotification[];
  unreadCount: number;
  proofs: AccountProof[];
  /** Tickets she can pick for the delivery scheduler. */
  schedulable: AccountLine[];
};

// ---------------------------------------------------------------------------
// Stage track
// ---------------------------------------------------------------------------

export const TRACK_STEPS = [
  { status: "ORDERED", short: "McAllen" },
  { status: "IN_TRANSIT", short: "Paquetería" },
  { status: "RECEIVED_LA_PAZ", short: "La Paz" },
  { status: "READY_FOR_DELIVERY", short: "Lista" },
  { status: "DELIVERED", short: "Entregada" },
] as const;

/** Index in TRACK_STEPS; -1 before it is bought in the store; null when the line is out of the track. */
export function trackIndex(status: LineStatus): number | null {
  switch (status) {
    case "WAITING_TO_ORDER": case "READY_TO_ORDER": case "PENDING_CONFIRMATION": return -1;
    case "ORDERED": return 0;
    case "IN_TRANSIT": return 1;
    case "RECEIVED_LA_PAZ": return 2;
    case "READY_FOR_DELIVERY": case "DELIVERY_SCHEDULED": return 3;
    case "DELIVERED": return 4;
    default: return null;
  }
}

export function statusLabel(status: LineStatus) {
  if (status === "PENDING_CONFIRMATION") return "Por confirmar";
  if (status === "CANCELLED" || status === "CANCELLED_INCIDENT") return "Cancelado";
  if (status === "WAITING_TO_ORDER") return "Registrado";
  if (status === "READY_TO_ORDER") return "Por comprar en tienda";
  return LOGISTICS_STATUS_LABELS[status] ?? status;
}

export function statusTone(line: Pick<AccountLine, "status" | "hasIncident">): BadgeTone {
  if (line.status === "CANCELLED" || line.status === "CANCELLED_INCIDENT") return "danger";
  if (line.hasIncident && line.status !== "DELIVERED") return "warning";
  if (line.status === "READY_FOR_DELIVERY" || line.status === "DELIVERY_SCHEDULED") return "success";
  if (line.status === "DELIVERED") return "neutral";
  return "rose";
}

/** One human sentence: where it is now and what happens next. */
export function statusPhrase(line: Pick<AccountLine, "status" | "hasIncident" | "source" | "booking" | "eta">) {
  if (line.status === "CANCELLED" || line.status === "CANCELLED_INCIDENT") return "Esta compra se canceló. Si tienes dudas sobre tus pagos, escríbenos y lo revisamos contigo.";
  if (line.hasIncident && line.status !== "DELIVERED") return "Hubo un detalle con tu producto al recibirlo en La Paz. Te contactaremos para darte opciones (reponerlo, cambiarlo o devolver tu dinero).";
  switch (line.status) {
    case "PENDING_CONFIRMATION": return "Recibimos tu pedido. Lo revisamos y te confirmamos muy pronto.";
    case "WAITING_TO_ORDER": return "Tu pedido está registrado. Lo compramos en la tienda cuando se cubra el pago acordado.";
    case "READY_TO_ORDER": return "Estamos por comprar tu producto en la tienda.";
    case "ORDERED": return "Tu producto ya está en nuestra bodega de McAllen, listo para enviarse a La Paz.";
    case "IN_TRANSIT": return line.eta ? `Tu pedido ya está en paquetería rumbo a La Paz. Llegada estimada: ${formatDayLong(line.eta)}.` : "Tu pedido ya está en paquetería rumbo a La Paz. Te avisamos cuando llegue.";
    case "RECEIVED_LA_PAZ": return "Tu pedido llegó a nuestra sucursal de La Paz. Lo revisamos y te avisamos cuando esté listo para entrega.";
    case "READY_FOR_DELIVERY": return line.source === "SALE_ITEM" ? "¡Ya está listo en La Paz! Escríbenos para coordinar tu entrega." : "¡Ya está listo en La Paz! Agenda tu entrega cuando gustes.";
    case "DELIVERY_SCHEDULED": return line.booking?.startsAt ? `Tu entrega está agendada para el ${formatDayLong(line.booking.startsAt)} a las ${formatTimeOnly(line.booking.startsAt)}.` : "Tu entrega está agendada.";
    case "DELIVERED": return "Entregado. ¡Gracias por tu compra!";
    default: return statusLabel(line.status);
  }
}

// ---------------------------------------------------------------------------
// Dates (business-local)
// ---------------------------------------------------------------------------

const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ });
const DAY_LONG = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: BUSINESS_TZ });
const DAY_SHORT = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: BUSINESS_TZ });
const DATE_SHORT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: BUSINESS_TZ });
const TIME_ONLY = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", timeZone: BUSINESS_TZ });

function toDate(value: string) {
  // A bare calendar date is read at local noon so it never shifts a day.
  return new Date(value.length === 10 ? `${value}T12:00:00-07:00` : value);
}
/** "sáb 10 oct" -> "Sáb 10 oct" (only the first letter). */
export function capitalize(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }
export function localDay(value: string | Date) { return DAY_KEY.format(typeof value === "string" ? toDate(value) : value); }
export function formatDayLong(value: string) { return DAY_LONG.format(toDate(value)); }
export function formatDayShort(value: string) { return capitalize(DAY_SHORT.format(toDate(value)).replace(/\./g, "").replace(" de ", " ")); }
export function formatDateShort(value: string) { return DATE_SHORT.format(toDate(value)).replace(/\./g, ""); }
export function formatTimeOnly(value: string) { return TIME_ONLY.format(toDate(value)); }

/** Mirrors client_cancel_delivery (migración 019): changeable while the slot is on a later local day. */
export function isChangeable(startsAt: string, now = new Date()) {
  return localDay(startsAt) > localDay(now);
}

// ---------------------------------------------------------------------------
// Scheduler helper: start times with `count` consecutive free 10-minute slots.
// The SQL function re-checks everything; this only decides what to offer.
// ---------------------------------------------------------------------------

export type SchedulerSlot = { id: string; availabilityId: string; startsAt: string; free: boolean };
export function bookableStarts(slots: SchedulerSlot[], count: number) {
  const sorted = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const result: SchedulerSlot[] = [];
  const need = Math.max(1, count);
  for (let i = 0; i < sorted.length; i += 1) {
    let ok = true;
    for (let k = 0; k < need; k += 1) {
      const slot = sorted[i + k];
      if (!slot || !slot.free || slot.availabilityId !== sorted[i].availabilityId || new Date(slot.startsAt).getTime() !== new Date(sorted[i].startsAt).getTime() + k * 600000) { ok = false; break; }
    }
    if (ok) result.push(sorted[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const NO_BALANCE_FINANCIAL = new Set(["CANCELLED_INCIDENT", "REFUND_PENDING", "REFUNDED", "DEFAULTED"]);
const PROOF_LABELS: Record<string, [string, BadgeTone]> = { PENDING: ["En revisión", "warning"], APPROVED: ["Aprobado", "success"], REJECTED: ["Rechazado", "danger"] };
const n = (value: unknown) => Number(value) || 0;

export function buildAccountOverview(raw: AccountRaw, image: (key: string | null | undefined) => string | null, now = new Date()): AccountOverview {
  const slotById = new Map(raw.slots.map((slot) => [slot.id, slot]));
  const bookingView = (b: RawBooking): AccountBooking => {
    const slot = slotById.get(b.slot_id);
    return { id: b.id, ticketId: b.ticket_id, status: b.status, deliveryType: b.delivery_type, bookedAt: b.booked_at, cancellationReason: b.cancellation_reason, startsAt: slot?.starts_at ?? null, endsAt: slot?.ends_at ?? null, locationName: slot?.location_name ?? null, locationAddress: slot?.location_address ?? null };
  };
  const activeBooking = new Map<string, AccountBooking>();
  const doneBooking = new Map<string, AccountBooking>();
  for (const b of raw.bookings) {
    if (b.status === "BOOKED") activeBooking.set(b.ticket_id, bookingView(b));
    else if (b.status === "COMPLETED" && !doneBooking.has(b.ticket_id)) doneBooking.set(b.ticket_id, bookingView(b));
  }
  const planByTicket = new Map(raw.plans.map((plan) => [plan.ticket_id, plan]));
  const reservationByTicket = new Map<string, RawReservation>();
  for (const r of raw.reservations) if (!reservationByTicket.has(r.ticket_id)) reservationByTicket.set(r.ticket_id, r);
  const ticketByItem = new Map(raw.tickets.map((t) => [t.order_item_id, t]));
  const proofView = (p: RawProof): AccountProof => {
    const [label, tone] = PROOF_LABELS[p.status] ?? [p.status, "neutral" as BadgeTone];
    return { id: p.id, ticketId: p.ticket_id, amountCents: n(p.reported_amount_cents), methodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method, status: p.status, statusLabel: label, tone, rejectionReason: p.rejection_reason, uploadedAt: p.uploaded_at };
  };

  function ticketLine(t: RawTicket): AccountLine {
    const cancelled = t.logistics_status === "CANCELLED_INCIDENT";
    const total = n(t.agreed_total_cents);
    const paid = n(t.paid_principal_cents);
    const booking = activeBooking.get(t.id) ?? doneBooking.get(t.id) ?? null;
    const reservation = reservationByTicket.get(t.id);
    return {
      key: `t-${t.id}`, source: "TICKET", ticketId: t.id, ticketNumber: t.ticket_number,
      name: t.product_name_snapshot, variant: t.variant_name_snapshot, quantity: n(t.quantity), unitLabel: null,
      imageUrl: image(t.image_storage_key_snapshot ?? (t.product_id ? raw.imageByProduct[t.product_id] : null)),
      status: t.logistics_status, statusUpdatedAt: t.updated_at,
      unitPriceCents: n(t.cash_unit_price_cents), discountCents: n(t.discount_cents), totalCents: total, paidCents: paid,
      balanceCents: cancelled || NO_BALANCE_FINANCIAL.has(t.financial_status) ? 0 : Math.max(0, total - paid),
      financialStatus: t.financial_status, hasIncident: Boolean(t.incident_reason && t.incident_reason.trim()),
      eta: ["ORDERED", "IN_TRANSIT"].includes(t.logistics_status) ? raw.etaByTicket[t.id] ?? null : null,
      booking,
      canSchedule: t.logistics_status === "READY_FOR_DELIVERY" && !activeBooking.has(t.id) && !NO_BALANCE_FINANCIAL.has(t.financial_status),
      scheduleByMessage: false,
      reservation: reservation ? { status: reservation.status, expiresAt: reservation.expires_at } : null,
      planId: planByTicket.get(t.id)?.id ?? null,
    };
  }

  const purchases: AccountPurchase[] = [];
  for (const order of raw.orders) {
    const items = raw.orderItems.filter((item) => item.order_id === order.id);
    const lines: AccountLine[] = items.map((item) => {
      const ticket = ticketByItem.get(item.id);
      if (ticket) return ticketLine(ticket);
      const total = n(item.unit_price_cents) * n(item.quantity);
      return {
        key: `oi-${item.id}`, source: "ORDER_ITEM", ticketId: null, ticketNumber: null,
        name: item.products?.name ?? "Producto", variant: item.product_variants?.name ?? null, quantity: n(item.quantity), unitLabel: null,
        imageUrl: image(item.product_id ? raw.imageByProduct[item.product_id] : null),
        status: order.status === "CANCELLED" ? "CANCELLED" : "PENDING_CONFIRMATION", statusUpdatedAt: order.created_at,
        unitPriceCents: n(item.unit_price_cents), discountCents: 0, totalCents: total, paidCents: 0, balanceCents: 0,
        financialStatus: null, hasIncident: false, eta: null, booking: null, canSchedule: false, scheduleByMessage: false, reservation: null, planId: null,
      };
    });
    // Tickets whose order_item was not returned (defensive): still hers, still shown.
    if (!lines.length) continue;
    const ticketIds = new Set(lines.flatMap((line) => line.ticketId ? [line.ticketId] : []));
    const live = lines.filter((line) => line.status !== "CANCELLED" && line.status !== "CANCELLED_INCIDENT");
    const state: PurchaseState = order.status === "CANCELLED" || !live.length ? "CANCELLED" : order.status === "DRAFT" ? "PENDING" : live.every((line) => line.status === "DELIVERED") ? "DELIVERED" : "ACTIVE";
    const counted = state === "PENDING" || state === "CANCELLED" ? [] : live;
    const ticketNumbers = lines.flatMap((line) => line.ticketNumber ? [line.ticketNumber] : []);
    purchases.push({
      key: `p-${order.id}`, kind: "ORDER",
      reference: ticketNumbers.length === 1 ? ticketNumbers[0] : `Pedido ${order.id.slice(0, 8).toUpperCase()}`,
      channel: order.origin === "WEBSITE" ? "Pedido en línea" : "Pedido",
      createdAt: order.created_at, lines,
      // A ticket's agreed total already nets its discount (and a weekly plan's own total).
      subtotalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
      discountCents: 0,
      totalCents: (state === "PENDING" ? lines : counted).reduce((sum, line) => sum + line.totalCents, 0),
      paidCents: (counted.length ? counted : lines).reduce((sum, line) => sum + line.paidCents, 0),
      balanceCents: counted.reduce((sum, line) => sum + line.balanceCents, 0),
      state,
      payments: raw.payments.filter((p) => ticketIds.has(p.ticket_id)).map((p) => ({ id: p.id, ticketId: p.ticket_id, amountCents: n(p.amount_cents), method: p.method, methodLabel: PAYMENT_METHOD_LABELS[p.method] ?? p.method, paidAt: p.effective_paid_at })).sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      proofs: raw.proofs.filter((p) => ticketIds.has(p.ticket_id)).map(proofView).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    });
  }

  const fulfillment = new Map(raw.fulfillment.map((row) => [row.id, row]));
  for (const sale of raw.sales) {
    const items = raw.saleItems.filter((item) => item.sale_id === sale.id);
    const cancelled = sale.status === "CANCELLED";
    const lines: AccountLine[] = items.map((item) => {
      // No fulfillment row (or migration 018 missing): handed over at the counter.
      const physical = fulfillment.get(item.id);
      const status = cancelled ? "CANCELLED" : physical?.logistics_status ?? "DELIVERED";
      const total = n(item.total_cents);
      return {
        key: `si-${item.id}`, source: "SALE_ITEM", ticketId: null, ticketNumber: null,
        name: item.product_name_snapshot, variant: item.variant_name_snapshot, quantity: n(item.quantity), unitLabel: item.unit_label,
        imageUrl: image(item.product_id ? raw.imageByProduct[item.product_id] : null),
        status, statusUpdatedAt: physical?.updated_at ?? sale.sold_at,
        unitPriceCents: n(item.unit_price_cents), discountCents: 0, totalCents: total, paidCents: cancelled ? 0 : total, balanceCents: 0,
        financialStatus: cancelled ? null : "PAID", hasIncident: false, eta: null, booking: null,
        canSchedule: false, scheduleByMessage: status === "READY_FOR_DELIVERY", reservation: null, planId: null,
      };
    });
    if (!lines.length) {
      lines.push({ key: `s-${sale.id}`, source: "SALE_ITEM", ticketId: null, ticketNumber: null, name: sale.concept?.trim() || "Compra en tienda", variant: null, quantity: 1, unitLabel: null, imageUrl: null, status: cancelled ? "CANCELLED" : "DELIVERED", statusUpdatedAt: sale.sold_at, unitPriceCents: n(sale.total_cents), discountCents: 0, totalCents: n(sale.total_cents), paidCents: cancelled ? 0 : n(sale.total_cents), balanceCents: 0, financialStatus: cancelled ? null : "PAID", hasIncident: false, eta: null, booking: null, canSchedule: false, scheduleByMessage: false, reservation: null, planId: null });
    }
    const total = cancelled ? 0 : n(sale.total_cents);
    purchases.push({
      key: `s-${sale.id}`, kind: "SALE", reference: sale.sale_number, channel: "Compra en tienda", createdAt: sale.sold_at, lines,
      subtotalCents: n(sale.subtotal_cents), discountCents: n(sale.discount_cents), totalCents: total, paidCents: total, balanceCents: 0,
      state: cancelled ? "CANCELLED" : lines.every((line) => line.status === "DELIVERED") ? "DELIVERED" : "ACTIVE",
      payments: cancelled ? [] : [{ id: `sale-${sale.id}`, ticketId: null, amountCents: total, method: sale.payment_method, methodLabel: PAYMENT_METHOD_LABELS[sale.payment_method] ?? sale.payment_method, paidAt: sale.sold_at }],
      proofs: [],
    });
  }
  const STATE_ORDER: Record<PurchaseState, number> = { ACTIVE: 0, PENDING: 1, DELIVERED: 2, CANCELLED: 3 };
  purchases.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.createdAt.localeCompare(a.createdAt));

  const allLines = purchases.flatMap((purchase) => purchase.lines);
  const lineByTicket = new Map(allLines.flatMap((line) => line.ticketId ? [[line.ticketId, line] as const] : []));
  const purchaseByTicket = new Map(purchases.flatMap((purchase) => purchase.lines.flatMap((line) => line.ticketId ? [[line.ticketId, purchase.key] as const] : [])));

  const plans: AccountPlan[] = raw.plans.map((plan) => {
    const line = lineByTicket.get(plan.ticket_id);
    const installments = raw.installments.filter((i) => i.payment_plan_id === plan.id).sort((a, b) => n(a.installment_number) - n(b.installment_number)).map((i): AccountInstallment => {
      const pending = Math.max(0, n(i.amount_cents) - n(i.paid_cents));
      const overdue = i.status === "OVERDUE" || (i.status !== "PAID" && pending > 0 && new Date(i.due_at).getTime() < now.getTime());
      return { id: i.id, number: n(i.installment_number), dueAt: i.due_at, amountCents: n(i.amount_cents), paidCents: n(i.paid_cents), pendingCents: i.status === "PAID" ? 0 : pending, status: i.status === "PAID" || pending === 0 ? "PAID" : overdue ? "OVERDUE" : i.status === "PARTIAL" || n(i.paid_cents) > 0 ? "PARTIAL" : "PENDING" };
    });
    const paidCount = installments.filter((i) => i.status === "PAID").length;
    return { id: plan.id, ticketId: plan.ticket_id, ticketNumber: line?.ticketNumber ?? "", productName: line?.name ?? "Tu compra", imageUrl: line?.imageUrl ?? null, purchaseKey: purchaseByTicket.get(plan.ticket_id) ?? null, status: plan.status, modeLabel: plan.mode === "LAYAWAY" ? "Apartado" : `Plan de ${plan.number_of_weeks ?? installments.length} semanas`, weeks: plan.number_of_weeks, installments, paidCount, progress: installments.length ? Math.round((paidCount / installments.length) * 100) : 0 };
  });

  const appointmentsMap = new Map<string, AccountAppointment>();
  for (const b of raw.bookings.filter((row) => row.status === "BOOKED")) {
    const view = bookingView(b);
    if (!view.startsAt) continue;
    const key = `${view.locationName}|${localDay(view.startsAt)}|${b.delivery_type}`;
    const line = lineByTicket.get(b.ticket_id);
    const existing = appointmentsMap.get(key);
    const entry = { name: line?.name ?? "Tu pedido", imageUrl: line?.imageUrl ?? null, ticketNumber: line?.ticketNumber ?? null, balanceCents: line?.balanceCents ?? 0 };
    if (existing) {
      existing.bookingIds.push(b.id); existing.ticketIds.push(b.ticket_id); existing.lines.push(entry);
      if (view.startsAt < existing.startsAt) existing.startsAt = view.startsAt;
      if ((view.endsAt ?? "") > existing.endsAt) existing.endsAt = view.endsAt ?? existing.endsAt;
      existing.canChange = existing.canChange && isChangeable(view.startsAt, now);
    } else {
      appointmentsMap.set(key, { key: b.id, bookingIds: [b.id], ticketIds: [b.ticket_id], startsAt: view.startsAt, endsAt: view.endsAt ?? view.startsAt, locationName: view.locationName ?? "Punto de entrega", locationAddress: view.locationAddress ?? "", deliveryType: b.delivery_type, lines: [entry], canChange: isChangeable(view.startsAt, now) });
    }
  }
  const appointments = [...appointmentsMap.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const counted = purchases.filter((purchase) => purchase.state === "ACTIVE" || purchase.state === "DELIVERED");
  const nextInstallment = plans.filter((plan) => plan.status === "ACTIVE").flatMap((plan) => plan.installments.filter((i) => i.status !== "PAID")).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const money: AccountMoney = {
    totalCents: counted.reduce((sum, p) => sum + p.totalCents, 0),
    paidCents: counted.reduce((sum, p) => sum + p.paidCents, 0),
    owedCents: counted.reduce((sum, p) => sum + p.balanceCents, 0),
    lateFeesCents: raw.fees.filter((fee) => fee.status === "PENDING" || fee.status === "PARTIAL").reduce((sum, fee) => sum + Math.max(0, n(fee.amount_cents) - n(fee.paid_cents)), 0),
    nextDue: nextInstallment ? { amountCents: nextInstallment.pendingCents, dueAt: nextInstallment.dueAt, overdue: nextInstallment.status === "OVERDUE" } : null,
  };

  const notifications = [...raw.notifications].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    purchases, plans, appointments, money, notifications,
    unreadCount: notifications.filter((item) => !item.read_at).length,
    proofs: raw.proofs.map(proofView).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    schedulable: allLines.filter((line) => line.canSchedule),
  };
}

// ---------------------------------------------------------------------------
// "Qué debes hacer ahora" — most urgent first.
// ---------------------------------------------------------------------------

const MONEY = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function moneyText(cents: number) { return MONEY.format((Number(cents) || 0) / 100); }

export function nextActions(overview: AccountOverview, now = new Date()): AccountAction[] {
  const actions: AccountAction[] = [];
  const { money } = overview;
  const overdue = overview.plans.flatMap((plan) => plan.status === "ACTIVE" ? plan.installments.filter((i) => i.status === "OVERDUE") : []);
  if (overdue.length || money.lateFeesCents > 0) {
    const amount = overdue.reduce((sum, i) => sum + i.pendingCents, 0) + money.lateFeesCents;
    actions.push({ tone: "urgent", title: `Tienes un pago vencido de ${moneyText(amount)}`, body: "Ponte al corriente para conservar tu pedido. Si ya pagaste, sube tu comprobante.", href: "/cuenta/pagos", cta: "Pagar o subir comprobante" });
  }
  const rejected = overview.proofs.find((proof) => proof.status === "REJECTED" && now.getTime() - new Date(proof.uploadedAt).getTime() < 14 * 86400000);
  if (rejected) actions.push({ tone: "urgent", title: "Revisa tu comprobante", body: rejected.rejectionReason ? `No pudimos validarlo: ${rejected.rejectionReason}` : "No pudimos validar tu comprobante. Puedes enviarlo de nuevo.", href: "/cuenta/pagos#comprobantes", cta: "Ver comprobante" });
  if (overview.schedulable.length) {
    const count = overview.schedulable.length;
    actions.push({ tone: "ready", title: count === 1 ? "¡Tu pedido está listo para entrega!" : `¡${count} productos están listos para entrega!`, body: "Elige el lugar, el día y la hora que te queden mejor.", href: "/cuenta/entregas#agendar", cta: "Agendar mi entrega" });
  }
  const byMessage = overview.purchases.flatMap((p) => p.lines).filter((line) => line.scheduleByMessage);
  if (byMessage.length) actions.push({ tone: "ready", title: byMessage.length === 1 ? "¡Tu compra está lista en La Paz!" : `¡${byMessage.length} productos están listos en La Paz!`, body: "Escríbenos para coordinar el día y la hora de tu entrega.", href: "/contacto", cta: "Coordinar mi entrega" });
  const reservation = overview.purchases.flatMap((p) => p.lines).filter((line) => line.reservation?.status === "ACTIVE").sort((a, b) => (a.reservation!.expiresAt).localeCompare(b.reservation!.expiresAt))[0];
  if (reservation) actions.push({ tone: "info", title: `Liquida tu apartado antes del ${formatDayLong(reservation.reservation!.expiresAt)}`, body: `${reservation.name}: saldo de ${moneyText(reservation.balanceCents)}.`, href: "/cuenta/pagos", cta: "Ver cómo pagar" });
  const appointment = overview.appointments[0];
  if (appointment) actions.push({ tone: "info", title: `Tu entrega: ${formatDayLong(appointment.startsAt)}, ${formatTimeOnly(appointment.startsAt)}`, body: `${appointment.locationName}${appointment.deliveryType === "DIDI" ? " · Envío por DiDi" : ""}.`, href: "/cuenta/entregas", cta: "Ver mi cita" });
  if (!overdue.length && money.nextDue) actions.push({ tone: "info", title: `Tu próximo pago: ${moneyText(money.nextDue.amountCents)}`, body: `Vence el ${formatDayLong(money.nextDue.dueAt)}.`, href: "/cuenta/pagos", cta: "Ver mis pagos" });
  else if (!overdue.length && !money.nextDue && money.owedCents > 0) actions.push({ tone: "info", title: `Saldo pendiente: ${moneyText(money.owedCents)}`, body: "Cuando pagues, sube tu comprobante para registrarlo.", href: "/cuenta/pagos", cta: "Pagar o subir comprobante" });
  if (!actions.length) {
    const moving = overview.purchases.some((p) => p.state === "ACTIVE" || p.state === "PENDING");
    actions.push(moving
      ? { tone: "ok", title: "Todo en orden", body: "Tus pedidos van avanzando. Te avisamos en cada paso.", href: "/cuenta/compras", cta: "Ver mis compras" }
      : { tone: "ok", title: "Todo en orden", body: "No tienes pagos ni entregas pendientes.", href: "/catalogo", cta: "Ver catálogo" });
  }
  return actions;
}
