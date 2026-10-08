// Client panel (/cuenta): scoped reads of lib/supabase/account.ts and the
// pure view model of lib/account-view.ts. node --test tests/account-data.test.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "rolldown";

const root = resolve(import.meta.dirname, "..");
await mkdir(resolve(root, ".tmp"), { recursive: true });
const mocks = {
  "\0auth": "export const getClientProfile = async () => globalThis.__session;",
  "\0business": "export const adminDb = () => globalThis.__admin; export const adminStorage = () => ({ from: () => ({ getPublicUrl: (key) => ({ data: { publicUrl: 'https://img.test/' + key } }) }) }); export const PRODUCT_IMAGE_BUCKET = 'oskinmx-catalog';",
  "\0reservations": "export const getClientReservations = async (id) => globalThis.__reservations(id);",
  "\0sales": "export const related = async (table, select, column, ids) => globalThis.__related(table, select, column, ids); export const getSaleItemFulfillment = async (ids) => ({ rows: globalThis.__fulfillment.filter((r) => ids.includes(r.id)), available: true });",
};
await build({
  input: "\0entry",
  plugins: [{
    name: "mocks",
    resolveId(source) {
      if (source === "\0entry" || mocks[source]) return source;
      if (source === "./auth") return "\0auth";
      if (source === "./business") return "\0business";
      if (source === "./incoming-reservations") return "\0reservations";
      if (source === "./sales") return "\0sales";
    },
    load(id) {
      if (id === "\0entry") return `export * from ${JSON.stringify(resolve(root, "lib/supabase/account.ts"))}; export * from ${JSON.stringify(resolve(root, "lib/account-view.ts"))};`;
      return mocks[id];
    },
  }],
  output: { file: resolve(root, ".tmp/account-data.test-bundle.mjs"), format: "esm" },
});
const api = await import("../.tmp/account-data.test-bundle.mjs");

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const now = new Date();
const days = (n) => new Date(now.getTime() + n * 86400000).toISOString();
const ticket = (n, extra) => ({ id: `t${n}`, order_item_id: `oi${n}`, ticket_number: `LF-2026-00000${n}`, product_id: null, product_name_snapshot: `Producto ${n}`, variant_name_snapshot: null, image_storage_key_snapshot: null, quantity: 1, cash_unit_price_cents: 100000, agreed_total_cents: 100000, discount_cents: 0, payment_mode: "FULL", financial_status: "PAID", logistics_status: "ORDERED", paid_principal_cents: 100000, incident_reason: null, created_at: days(-10), updated_at: days(-1), ...extra });

function sessionDb(tables) {
  const reads = [];
  return {
    reads,
    schema: () => ({
      from(table) {
        const read = { table, filters: [] };
        reads.push(read);
        const q = { select(cols) { read.select = cols; return q; }, eq(c, v) { read.filters.push([c, v]); return q; }, order() { return q; }, limit() { return q; }, is() { return q; },
          maybeSingle() { return Promise.resolve({ data: tables[`${table}:single`] ?? null, error: null }); },
          then(res, rej) { return Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej); } };
        return q;
      },
    }),
  };
}

test("reads are scoped to the verified client and never select costs or internal notes", async () => {
  const relatedReads = [];
  const session = sessionDb({
    orders: [{ id: "o1", status: "CONFIRMED", created_at: days(-10), confirmed_at: days(-10), cancelled_at: null, origin: "ADMIN_MANUAL" }],
    tickets: [ticket(1, { image_storage_key_snapshot: "shopper/photo.jpg" })],
  });
  globalThis.__session = { supabase: session, user: { id: ME }, profile: { id: ME, first_name: "Itia", status: "ACTIVE" } };
  globalThis.__admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { telegram_chat_id: null } }) }) }) }) };
  globalThis.__reservations = async () => [];
  globalThis.__fulfillment = [{ id: "si1", logistics_status: "ORDERED", updated_at: days(-1) }];
  globalThis.__related = async (table, select, column, ids) => {
    relatedReads.push({ table, select, column, ids });
    if (table === "order_items") return [{ id: "oi1", order_id: "o1", product_id: null, quantity: 1, unit_price_cents: 100000 }];
    // A foreign sale slipping through would be dropped by the client_id re-check.
    if (table === "sales") return [{ id: "s1", sale_number: "VD-2026-000002", status: "COMPLETED", sold_at: days(-2), subtotal_cents: 109000, discount_cents: 0, total_cents: 109000, payment_method: "TRANSFER", sale_type: "PRODUCT", concept: null, client_id: ME }, { id: "s9", sale_number: "VD-AJENA", status: "COMPLETED", sold_at: days(-2), subtotal_cents: 1, discount_cents: 0, total_cents: 1, payment_method: "CASH", sale_type: "PRODUCT", concept: null, client_id: OTHER }];
    if (table === "sale_items") return [{ id: "si1", sale_id: "s1", product_id: "p1", product_name_snapshot: "Bolsa de hombro tommy hilfiger café tipo gamuza", variant_name_snapshot: "Único", quantity: 1, unit_price_cents: 109000, total_cents: 109000, unit_label: null }].filter((i) => ids.includes(i.sale_id));
    if (table === "product_images") return [{ id: "img", product_id: "p1", storage_key: "p1/bolsa.jpg", sort_order: 0 }];
    return [];
  };
  const data = await api.getAccountOverview();
  assert.deepEqual(relatedReads.find((r) => r.table === "sales").ids, [ME]);
  assert.deepEqual(relatedReads.find((r) => r.table === "order_items").ids, ["o1"]);
  assert.deepEqual(relatedReads.find((r) => r.table === "payments").ids, ["t1"]);
  assert.deepEqual(relatedReads.find((r) => r.table === "sale_items").ids, ["s1"]);
  for (const r of [...relatedReads, ...session.reads]) assert.doesNotMatch(r.select ?? "", /cost|internal_notes|commission|notes|store_name|carrier|tracking/);
  for (const t of ["orders", "tickets", "notifications", "delivery_bookings"]) assert.deepEqual(session.reads.find((r) => r.table === t).filters[0], ["client_id", ME]);
  const purchases = data.overview.purchases;
  assert.equal(purchases.length, 2);
  assert.ok(!purchases.some((p) => p.reference === "VD-AJENA"));
  const sale = purchases.find((p) => p.reference === "VD-2026-000002");
  assert.equal(sale.lines[0].imageUrl, "https://img.test/p1/bolsa.jpg");
  assert.equal(sale.lines[0].status, "ORDERED");
  assert.equal(sale.paidCents, 109000);
  assert.equal(sale.balanceCents, 0);
  const shopper = purchases.find((p) => p.kind === "ORDER");
  assert.equal(shopper.lines[0].imageUrl, "https://img.test/shopper/photo.jpg");
  assert.equal(shopper.lines[0].name, "Producto 1");
});

const base = () => ({ orders: [], orderItems: [], tickets: [], sales: [], saleItems: [], fulfillment: [], plans: [], installments: [], fees: [], payments: [], proofs: [], bookings: [], slots: [], notifications: [], reservations: [], etaByTicket: {}, imageByProduct: {} });
const img = (k) => (k ? `img:${k}` : null);
const order = (id, status = "CONFIRMED") => ({ id, status, created_at: days(-5), confirmed_at: null, cancelled_at: null, origin: "WEBSITE" });

test("money, plans, stages, incidents and next action", () => {
  const raw = base();
  raw.orders = [order("o1"), order("o2"), order("o3"), order("o4", "DRAFT")];
  raw.orderItems = [{ id: "oi1", order_id: "o1", product_id: "p1", quantity: 1, unit_price_cents: 100000 }, { id: "oi2", order_id: "o2", product_id: null, quantity: 1, unit_price_cents: 50000 }, { id: "oi3", order_id: "o3", product_id: null, quantity: 1, unit_price_cents: 30000 }, { id: "oi4", order_id: "o4", product_id: "p4", quantity: 2, unit_price_cents: 1000 }];
  raw.tickets = [
    ticket(1, { order_item_id: "oi1", product_id: "p1", logistics_status: "READY_FOR_DELIVERY", agreed_total_cents: 120000, paid_principal_cents: 40000, financial_status: "CURRENT", payment_mode: "WEEKLY_PLAN" }),
    ticket(2, { order_item_id: "oi2", logistics_status: "RECEIVED_LA_PAZ", incident_reason: "Recepción EMB: 1 dañada", agreed_total_cents: 50000, paid_principal_cents: 50000 }),
    ticket(3, { order_item_id: "oi3", logistics_status: "CANCELLED_INCIDENT", agreed_total_cents: 30000, paid_principal_cents: 10000, financial_status: "CANCELLED_INCIDENT" }),
  ];
  raw.imageByProduct = { p1: "p1/a.jpg" };
  raw.plans = [{ id: "pl1", ticket_id: "t1", mode: "WEEKLY_PLAN", status: "ACTIVE", agreed_total_cents: 120000, number_of_weeks: 4, start_date: "2026-09-01", due_date: null }];
  raw.installments = [1, 2, 3, 4].map((k) => ({ id: `i${k}`, payment_plan_id: "pl1", installment_number: k, due_at: days(k * 7 - 15), amount_cents: 30000, paid_cents: k === 1 ? 30000 : k === 2 ? 10000 : 0, status: k === 1 ? "PAID" : "PENDING" }));
  const view = api.buildAccountOverview(raw, img, now);
  const [o1, o2, o3, o4] = ["o1", "o2", "o3", "o4"].map((k) => view.purchases.find((p) => p.key === `p-${k}`));
  assert.equal(o1.lines[0].imageUrl, "img:p1/a.jpg");
  assert.equal(o1.lines[0].canSchedule, true);
  assert.equal(o1.balanceCents, 80000);
  assert.equal(o2.lines[0].hasIncident, true);
  assert.match(api.statusPhrase(o2.lines[0]), /detalle/);
  assert.doesNotMatch(api.statusPhrase(o2.lines[0]), /EMB|dañada/);
  assert.equal(o3.state, "CANCELLED");
  assert.equal(o4.state, "PENDING");
  assert.equal(o4.lines[0].status, "PENDING_CONFIRMATION");
  assert.equal(o2.lines[0].imageUrl, null);
  // Totals count only live, confirmed purchases.
  assert.equal(view.money.totalCents, 170000);
  assert.equal(view.money.paidCents, 90000);
  assert.equal(view.money.owedCents, 80000);
  const plan = view.plans[0];
  assert.deepEqual(plan.installments.map((i) => i.status), ["PAID", "OVERDUE", "PENDING", "PENDING"]);
  assert.equal(plan.installments[1].pendingCents, 20000);
  assert.equal(view.money.nextDue.overdue, true);
  const actions = api.nextActions(view, now);
  assert.equal(actions[0].tone, "urgent");
  assert.match(actions[0].title, /vencido/);
  assert.ok(actions.some((a) => a.cta === "Agendar mi entrega"));
  assert.equal(api.trackIndex("DELIVERY_SCHEDULED"), 3);
  assert.equal(api.trackIndex("CANCELLED_INCIDENT"), null);
});

test("sale items use sale_item_fulfillment and are coordinated by message", () => {
  const raw = base();
  raw.sales = [{ id: "s1", sale_number: "VD-1", status: "COMPLETED", sold_at: days(-3), subtotal_cents: 2000, discount_cents: 200, total_cents: 1800, payment_method: "CASH", sale_type: "PRODUCT", concept: null }];
  raw.saleItems = [{ id: "a", sale_id: "s1", product_id: null, product_name_snapshot: "A", variant_name_snapshot: null, quantity: 1, unit_price_cents: 1000, total_cents: 1000, unit_label: null }, { id: "b", sale_id: "s1", product_id: null, product_name_snapshot: "B", variant_name_snapshot: null, quantity: 1, unit_price_cents: 1000, total_cents: 1000, unit_label: null }];
  raw.fulfillment = [{ id: "a", logistics_status: "READY_FOR_DELIVERY", updated_at: days(-1) }];
  const view = api.buildAccountOverview(raw, img, now);
  const sale = view.purchases[0];
  assert.deepEqual(sale.lines.map((l) => l.status), ["READY_FOR_DELIVERY", "DELIVERED"]);
  assert.equal(sale.state, "ACTIVE");
  assert.equal(sale.totalCents, 1800);
  assert.equal(sale.lines[0].scheduleByMessage, true);
  assert.equal(sale.lines[0].canSchedule, false);
  assert.ok(api.nextActions(view, now).some((a) => a.href === "/contacto"));
  assert.equal(view.money.owedCents, 0);
  assert.equal(api.nextActions(base() && api.buildAccountOverview(base(), img, now), now)[0].title, "Todo en orden");
});

test("appointments group her bookings and follow the day-before rule", () => {
  const raw = base();
  raw.orders = [order("o1")];
  raw.orderItems = [{ id: "oi1", order_id: "o1", product_id: null, quantity: 1, unit_price_cents: 1 }, { id: "oi2", order_id: "o1", product_id: null, quantity: 1, unit_price_cents: 1 }];
  raw.tickets = [ticket(1, { order_item_id: "oi1", logistics_status: "DELIVERY_SCHEDULED" }), ticket(2, { order_item_id: "oi2", logistics_status: "DELIVERY_SCHEDULED" })];
  const start = days(3);
  raw.slots = [{ id: "s1", starts_at: start, ends_at: new Date(new Date(start).getTime() + 600000).toISOString(), location_name: "Punto", location_address: "Calle" }, { id: "s2", starts_at: new Date(new Date(start).getTime() + 600000).toISOString(), ends_at: new Date(new Date(start).getTime() + 1200000).toISOString(), location_name: "Punto", location_address: "Calle" }];
  raw.bookings = [{ id: "b1", ticket_id: "t1", slot_id: "s1", delivery_type: "PICKUP", status: "BOOKED", booked_at: days(-1), cancellation_reason: null }, { id: "b2", ticket_id: "t2", slot_id: "s2", delivery_type: "PICKUP", status: "BOOKED", booked_at: days(-1), cancellation_reason: null }];
  const view = api.buildAccountOverview(raw, img, now);
  assert.equal(view.appointments.length, 1);
  assert.deepEqual(view.appointments[0].bookingIds.sort(), ["b1", "b2"]);
  assert.equal(view.appointments[0].canChange, true);
  assert.equal(view.schedulable.length, 0);
  assert.equal(api.isChangeable(now.toISOString(), now), false);
});

test("scheduler only offers runs of consecutive free slots", () => {
  const t0 = Date.parse("2026-10-20T17:00:00Z");
  const s = (k, free = true, av = "a") => ({ id: `x${k}`, availabilityId: av, startsAt: new Date(t0 + k * 600000).toISOString(), free });
  const slots = [s(0), s(1, false), s(2), s(3), s(4), s(6)];
  assert.deepEqual(api.bookableStarts(slots, 1).map((x) => x.id), ["x0", "x2", "x3", "x4", "x6"]);
  assert.deepEqual(api.bookableStarts(slots, 2).map((x) => x.id), ["x2", "x3"]);
  assert.deepEqual(api.bookableStarts([s(0), s(1, true, "b")], 2), []);
});
