// Migration 020 (delivery requests the owner confirms) against the real schema.
// Run with Node 24 after installing PGlite OUTSIDE package.json, e.g.:
//   npm install --prefix .tmp/pglite --no-package-lock @electric-sql/pglite
//   node tests/delivery-requests.pglite.mjs
// or point PGLITE_DIR at any folder where @electric-sql/pglite is installed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pgliteDir = process.env.PGLITE_DIR ?? path.resolve(import.meta.dirname, "../.tmp/pglite");
const { PGlite } = await import(pathToFileURL(path.join(pgliteDir, "node_modules/@electric-sql/pglite/dist/index.js")).href);

const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1), B = id(2), OWNER = id(3), EMPLOYEE = id(4), C = id(5);
const sql = (q, p) => db.query(q, p);
const one = async (q, p) => (await sql(q, p)).rows[0];
async function rejects(promise, pattern, label) {
  try { await promise; } catch (error) { assert.match(error.message, pattern, `${label}: ${error.message}`); return; }
  assert.fail(`${label}: should have failed`);
}
const migration = (n) => fs.readFileSync(`database/migrations/${fs.readdirSync("database/migrations").find((f) => f.startsWith(`${n}_`))}`, "utf8").replace(/\bcitext\b/g, "text");

await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,allowed_mime_types text[]); CREATE TABLE storage.objects(name text,bucket_id text); CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS 'SELECT string_to_array(name,''/'')'; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
await db.exec(fs.readFileSync("database/schema.sql", "utf8").replace(/CREATE EXTENSION IF NOT EXISTS (citext|pgcrypto);/g, "").replace(/\bcitext\b/g, "text"));
for (const n of ["001", "002", "008", "009", "010", "011", "012", "013", "014", "015", "016", "017", "018", "019"]) await db.exec(migration(n));
await db.exec("SET search_path TO luxury_finds, public");

// Business-local days (UTC-7).
const local = (offsetDays, hhmm) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
  return `${day}T${hhmm}:00-07:00`;
};

await sql("INSERT INTO auth.users VALUES ($1),($2),($3),($4),($5)", [A, B, OWNER, EMPLOYEE, C]);
await sql("INSERT INTO admin_users(id,username,display_name,role) VALUES ($1,'TEMP-owner','TEMP Dueña','OWNER'),($2,'TEMP-staff','TEMP Empleado','EMPLOYEE')", [OWNER, EMPLOYEE]);
await sql("INSERT INTO clients(id,phone,first_name,last_name) VALUES ($1,'TEMP-1','Ana','Prueba'),($2,'TEMP-2','Bea','Prueba'),($3,'TEMP-3','Cris','Prueba')", [A, B, C]);
await sql("INSERT INTO delivery_locations(id,name,address) VALUES ($1,'TEMP Punto','Calle 1')", [id(10)]);
// AV1: day+2 10:00, 8 slots, pickup+didi. AV2: day+3 16:00, 4 slots, pickup only. AVT: tomorrow 00:00-ish for "today" checks.
const avs = [[id(11), 2, "10:00", 8, true, true], [id(12), 3, "16:00", 4, true, false], [id(13), 4, "09:00", 6, true, true]];
const slot = {};
for (const [av, day, start, count, pickup, didi] of avs) {
  const s = new Date(local(day, start));
  await sql("INSERT INTO delivery_availabilities(id,location_id,starts_at,ends_at,enabled_pickup,enabled_didi,created_by_admin_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [av, id(10), s.toISOString(), new Date(s.getTime() + count * 600000).toISOString(), pickup, didi, OWNER]);
  for (let k = 0; k < count; k++) {
    const r = await sql("INSERT INTO delivery_slots(availability_id,starts_at,ends_at) VALUES ($1,$2,$3) RETURNING id", [av, new Date(s.getTime() + k * 600000).toISOString(), new Date(s.getTime() + (k + 1) * 600000).toISOString()]);
    slot[`${av.slice(-2)}-${k}`] = r.rows[0].id;
  }
}
let ticketSeq = 0;
async function ticket(client, status = "READY_FOR_DELIVERY") {
  const n = ++ticketSeq;
  await sql("INSERT INTO orders(id,client_id,origin,status) VALUES ($1,$2,'ADMIN_MANUAL','CONFIRMED')", [id(1000 + n), client]);
  await sql("INSERT INTO order_items(id,order_id,quantity,unit_price_cents) VALUES ($1,$2,1,10000)", [id(2000 + n), id(1000 + n)]);
  await sql("INSERT INTO tickets(id,order_item_id,client_id,product_name_snapshot,quantity,cash_unit_price_cents,agreed_total_cents,payment_mode,catalog_type_snapshot,logistics_status) VALUES ($1,$2,$3,$4,1,10000,10000,'FULL','ON_DEMAND',$5)", [id(3000 + n), id(2000 + n), client, `TEMP producto ${n}`, status]);
  return id(3000 + n);
}
const book = (client, tickets, slotId, type = "PICKUP", re = false) => sql("SELECT * FROM client_book_delivery($1,$2::uuid[],$3,$4::delivery_type,$5)", [client, tickets, slotId, type, re]);
const cancel = (client, bookings) => sql("SELECT * FROM client_cancel_delivery($1,$2::uuid[])", [client, bookings]);
const confirm = (visit, admin = OWNER) => one("SELECT confirm_delivery_request($1,$2) AS r", [visit, admin]);
const reject = (visit, reason, admin = OWNER) => one("SELECT reject_delivery_request($1,$2,$3) AS r", [visit, admin, reason]);
const status = async (t) => (await one("SELECT logistics_status FROM tickets WHERE id=$1", [t])).logistics_status;
const lastNotice = (client) => one("SELECT type, title, body, ticket_id FROM notifications WHERE client_id=$1 ORDER BY created_at DESC, title LIMIT 1", [client]);

// --- Before 020: an owner booking and a 019 self-service booking (both confirmed appointments).
const L1 = await ticket(C), L2 = await ticket(C), L3 = await ticket(A);
const legacyAdmin = await one("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type) VALUES ($1,$2,$3,'PICKUP') RETURNING id, booked_at", [slot["13-0"], L1, C]);
await sql("UPDATE tickets SET logistics_status='DELIVERY_SCHEDULED' WHERE id=$1", [L1]);
const legacy019 = await book(C, [L2], slot["13-1"]);
assert.equal(await status(L2), "DELIVERY_SCHEDULED", "019 flow schedules right away");
const legacyDone = await one("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type) VALUES ($1,$2,$3,'PICKUP') RETURNING id", [slot["13-2"], L3, A]);
await sql("UPDATE delivery_bookings SET status='COMPLETED', completed_at=now() WHERE id=$1", [legacyDone.id]);

// --- Apply 020 (then again later, with a pending request in between).
await db.exec(migration("020"));
await db.exec("SET search_path TO luxury_finds, public");

// 1. Backfill: every booking that existed is a confirmed appointment, its own visit.
for (const bookingId of [legacyAdmin.id, legacy019.rows[0].r_booking_id, legacyDone.id]) {
  const row = await one("SELECT confirmed_at, booked_at, visit_id, id FROM delivery_bookings WHERE id=$1", [bookingId]);
  assert.ok(row.confirmed_at, "backfilled confirmed");
  assert.equal(row.confirmed_at.getTime(), row.booked_at.getTime(), "confirmed_at = booked_at");
  assert.equal(row.visit_id, row.id, "visit_id = id");
}
assert.equal((await one("SELECT count(*)::int c FROM pg_indexes WHERE indexname='uq_delivery_slot_active'")).c, 0, "old index dropped");
assert.equal((await one("SELECT count(*)::int c FROM pg_indexes WHERE indexname='uq_delivery_ticket_active'")).c, 1, "ticket index kept");

// 2. A request for ONE ticket: one row, pending, ticket still READY, notice + log.
const T1 = await ticket(A);
const r1 = await book(A, [T1], slot["11-0"]);
assert.equal(r1.rows.length, 1);
const v1 = await one("SELECT visit_id, confirmed_at, status, id FROM delivery_bookings WHERE id=$1", [r1.rows[0].r_booking_id]);
assert.equal(v1.status, "BOOKED");
assert.equal(v1.confirmed_at, null, "request is pending");
assert.equal(v1.visit_id, v1.id, "leader row");
assert.equal(await status(T1), "READY_FOR_DELIVERY", "request does not schedule the ticket");
let notice = await lastNotice(A);
assert.equal(notice.title, "Solicitud recibida: espera la confirmación");
assert.match(notice.body, /Apartamos tu horario del (lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d+ de \w+ a las 10:00 a\. m\. en TEMP Punto/);
assert.equal((await one("SELECT count(*)::int c FROM activity_logs WHERE client_id=$1 AND action='DELIVERY_REQUESTED_BY_CLIENT'", [A])).c, 1);

// 2b. Applying 020 again does not confirm pending requests (backfill runs once).
await db.exec(migration("020"));
await db.exec("SET search_path TO luxury_finds, public");
assert.equal((await one("SELECT confirmed_at FROM delivery_bookings WHERE id=$1", [v1.id])).confirmed_at, null, "rerun keeps the request pending");

// 3. A request for THREE tickets takes ONE slot, one visit.
const T2 = await ticket(A), T3 = await ticket(A), T4 = await ticket(A);
const r3 = await book(A, [T2, T3, T4], slot["11-1"]);
assert.equal(r3.rows.length, 3);
assert.deepEqual([...new Set(r3.rows.map((r) => r.r_slot_id))], [slot["11-1"]], "all in the same slot");
const visit3 = await sql("SELECT DISTINCT visit_id FROM delivery_bookings WHERE id = ANY($1::uuid[])", [r3.rows.map((r) => r.r_booking_id)]);
assert.equal(visit3.rows.length, 1, "one visit");
const V3 = visit3.rows[0].visit_id;
assert.ok(r3.rows.some((r) => r.r_booking_id === V3), "the visit has a leader row");
assert.equal((await one("SELECT count(*)::int c FROM delivery_bookings WHERE slot_id=$1 AND status='BOOKED'", [slot["11-2"]])).c, 0, "no consecutive slots any more");

// 4. Two different visits never share a slot.
const TB = await ticket(B), TB2 = await ticket(B);
await rejects(book(B, [TB], slot["11-1"]), /se acaba de ocupar/, "other client, taken slot");
await rejects(book(B, [TB], slot["11-0"]), /se acaba de ocupar/, "other client, pending slot");
// ...not even by inserting directly (the owner's path / a buggy caller): the trigger stops it.
await rejects(sql("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type) VALUES ($1,$2,$3,'PICKUP')", [slot["11-1"], TB, B]), /se acaba de ocupar/, "direct insert, other visit");
// ...and with the trigger disabled, the leader index still does.
await db.exec("ALTER TABLE delivery_bookings DISABLE TRIGGER trg_delivery_bookings_visit");
const tmpId = id(9001);
await rejects(sql("INSERT INTO delivery_bookings(id,visit_id,slot_id,ticket_id,client_id,delivery_type) VALUES ($1,$1,$2,$3,$4,'PICKUP')", [tmpId, slot["11-1"], TB, B]), /uq_delivery_slot_visit_leader|duplicate/, "leader index backstop");
await db.exec("ALTER TABLE delivery_bookings ENABLE TRIGGER trg_delivery_bookings_visit");
// Two tickets of the SAME visit may share it (direct insert with the visit id).
const T5 = await ticket(A);
await sql("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type,visit_id,confirmed_at) VALUES ($1,$2,$3,'PICKUP',$4,NULL)", [slot["11-1"], T5, A, V3]);
assert.equal((await one("SELECT count(*)::int c FROM delivery_bookings WHERE slot_id=$1 AND status='BOOKED'", [slot["11-1"]])).c, 4);
// Simulated race: two clients ask for the same free slot; the first commits, the second loses.
const race = await Promise.allSettled([book(B, [TB], slot["11-3"]), book(C, [await ticket(C)], slot["11-3"])]);
assert.equal(race.filter((r) => r.status === "fulfilled").length, 1, "one wins");
assert.match(race.find((r) => r.status === "rejected").reason.message, /se acaba de ocupar/, "the other is told");

// 5. Not hers / not ready.
await rejects(book(B, [T1, TB2], slot["11-4"]), /no pertenece/, "foreign ticket");
const TN = await ticket(A, "IN_TRANSIT");
await rejects(book(A, [TN], slot["11-4"]), /no está listo/, "not ready");
await rejects(book(A, [T1], slot["11-4"]), /solicitud o cita activa/, "same ticket twice");
await rejects(book(A, [await ticket(A)], slot["12-0"], "DIDI"), /modalidad/, "mode disabled");

// 6. Pending cap: A already has 2 pending visits; a third is fine, a fourth is not.
const T6 = await ticket(A), T7 = await ticket(A);
const r6 = await book(A, [T6], slot["11-5"]);
await rejects(book(A, [T7], slot["11-6"]), /Ya tienes 3 solicitudes/, "cap of 3 pending visits");

// 7. Only the owner confirms; confirming schedules the tickets and tells her "puedes pasar".
await rejects(confirm(V3, EMPLOYEE), /Solo la dueña/, "employee cannot confirm");
const confirmed = (await confirm(V3)).r;
assert.equal(confirmed.clientId, A);
for (const t of [T2, T3, T4, T5]) assert.equal(await status(t), "DELIVERY_SCHEDULED", "confirmed ticket scheduled");
assert.equal((await one("SELECT count(*)::int c FROM delivery_bookings WHERE visit_id=$1 AND confirmed_at IS NOT NULL AND confirmed_by_admin_id=$2", [V3, OWNER])).c, 4);
notice = await lastNotice(A);
assert.equal(notice.type, "DELIVERY_BOOKED");
assert.equal(notice.title, "Tu cita fue confirmada");
assert.match(notice.body, /^Puedes pasar el \S+ \d+ de \S+ a las 10:10 a\. m\. en TEMP Punto \(Calle 1\)\. Productos: LF-/);
assert.match(notice.body, /Recuerda: tienes un mes para recogerlo/);
assert.equal((await one("SELECT count(*)::int c FROM activity_logs WHERE admin_user_id=$1 AND action='DELIVERY_REQUEST_CONFIRMED'", [OWNER])).c, 1);
await rejects(confirm(V3), /ya estaba confirmada/, "confirm twice");
// Now the cap counts 2 pending (V1 and r6): A can ask again.
const r7 = await book(A, [T7], slot["11-6"]);

// 8. Reject: reason required; frees the slot, tickets stay ready, she is told why.
const V7 = (await one("SELECT visit_id FROM delivery_bookings WHERE id=$1", [r7.rows[0].r_booking_id])).visit_id;
await rejects(reject(V7, "   "), /motivo/, "reason required");
await rejects(reject(V3, "x"), /ya está confirmada/, "reject a confirmed one");
await reject(V7, "Ese día no estaré en el punto");
const rejectedRow = await one("SELECT status, rejected_at, rejected_by_admin_id, cancellation_reason FROM delivery_bookings WHERE id=$1", [r7.rows[0].r_booking_id]);
assert.equal(rejectedRow.status, "CANCELLED");
assert.ok(rejectedRow.rejected_at);
assert.equal(rejectedRow.rejected_by_admin_id, OWNER);
assert.equal(rejectedRow.cancellation_reason, "Ese día no estaré en el punto");
assert.equal(await status(T7), "READY_FOR_DELIVERY");
notice = await lastNotice(A);
assert.equal(notice.type, "DELIVERY_CANCELLED");
assert.match(notice.body, /Motivo: Ese día no estaré en el punto\./);
await book(B, [TB2], slot["11-6"]); // freed for anyone
await rejects(reject(V7, "otra vez"), /ya no está activa/, "reject twice");

// 9. She cancels a pending request: slot freed, ticket ready.
await cancel(A, [r6.rows[0].r_booking_id]);
assert.equal((await one("SELECT status, cancellation_reason FROM delivery_bookings WHERE id=$1", [r6.rows[0].r_booking_id])).cancellation_reason, "Solicitud cancelada por la clienta");
assert.equal(await status(T6), "READY_FOR_DELIVERY");
await rejects(cancel(B, [v1.id]), /no encontrada/, "foreign cancel");

// 10. Rescheduling a CONFIRMED visit turns it back into a pending request.
const moved = await book(A, [T2, T3, T4, T5], slot["12-1"], "PICKUP", true);
assert.equal(moved.rows.length, 4);
assert.equal((await one("SELECT count(*)::int c FROM delivery_bookings WHERE visit_id=$1 AND status='BOOKED'", [V3])).c, 0, "old visit released");
assert.equal((await one("SELECT count(DISTINCT visit_id)::int c FROM delivery_bookings WHERE id = ANY($1::uuid[]) AND confirmed_at IS NULL", [moved.rows.map((r) => r.r_booking_id)])).c, 1, "new pending visit");
for (const t of [T2, T3, T4, T5]) assert.equal(await status(t), "READY_FOR_DELIVERY", "back to ready until confirmed");
// Rescheduling a pending request keeps it pending.
const moved1 = await book(A, [T1], slot["12-2"], "PICKUP", true);
assert.equal((await one("SELECT confirmed_at FROM delivery_bookings WHERE id=$1", [moved1.rows[0].r_booking_id])).confirmed_at, null);

// 11. The owner's own booking (BookSlotDialog inserts without these columns) is born confirmed.
const TA = await ticket(C);
const ownerBooking = await one("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type,status) VALUES ($1,$2,$3,'PICKUP','BOOKED') RETURNING id, visit_id, confirmed_at", [slot["13-3"], TA, C]);
assert.ok(ownerBooking.confirmed_at, "owner booking confirmed");
assert.equal(ownerBooking.visit_id, ownerBooking.id, "owner booking is its own visit");

// 12. The employee cannot hand over a pending request.
const VM = (await one("SELECT visit_id FROM delivery_bookings WHERE id=$1", [moved.rows[0].r_booking_id])).visit_id;
const staffPayload = (client, tickets) => JSON.stringify({ client_id: client, received_by: "CLIENT", amount_cents: 0, balance_acknowledged: true, notes: "TEMP prueba", tickets: tickets.map((t) => ({ id: t, balance_cents: 10000 })) });
await rejects(sql("SELECT confirm_staff_delivery($1,$2::jsonb)", [EMPLOYEE, staffPayload(A, [T2])]), /ya no está programado/, "pending ticket is not deliverable");
// Even if someone moved the ticket by hand, the pending booking cannot be completed.
await sql("UPDATE tickets SET logistics_status='DELIVERY_SCHEDULED' WHERE id=$1", [T1]);
await rejects(sql("SELECT confirm_staff_delivery($1,$2::jsonb)", [EMPLOYEE, staffPayload(A, [T1])]), /por confirmar/, "pending booking cannot be completed");
await rejects(sql("UPDATE delivery_bookings SET status='COMPLETED', completed_at=now() WHERE id=$1", [moved1.rows[0].r_booking_id]), /por confirmar/, "owner Completar on a pending one");
await sql("UPDATE tickets SET logistics_status='READY_FOR_DELIVERY' WHERE id=$1", [T1]);
// Once the owner confirms, the employee can deliver.
await confirm(VM);
const confirmationId = (await one("SELECT confirm_staff_delivery($1,$2::jsonb) AS id", [EMPLOYEE, staffPayload(A, [T2, T3])])).id;
assert.ok(confirmationId);
assert.equal(await status(T2), "DELIVERED");
assert.equal((await one("SELECT status FROM delivery_bookings WHERE ticket_id=$1 AND visit_id=$2", [T2, VM])).status, "COMPLETED");

// 13. A confirmed appointment on the same day cannot be cancelled online; a pending request can.
const TT = await ticket(B), TU = await ticket(B);
const todaySlot = await one("INSERT INTO delivery_slots(availability_id,starts_at,ends_at) VALUES ($1, now() + interval '2 hours', now() + interval '2 hours 10 minutes') RETURNING id", [id(13)]);
const todaySlot2 = await one("INSERT INTO delivery_slots(availability_id,starts_at,ends_at) VALUES ($1, now() + interval '3 hours', now() + interval '3 hours 10 minutes') RETURNING id", [id(13)]);
const sameDay = await one("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type) VALUES ($1,$2,$3,'PICKUP') RETURNING id", [todaySlot.id, TT, B]);
const sameDayPending = await one("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type,confirmed_at) VALUES ($1,$2,$3,'PICKUP',NULL) RETURNING id", [todaySlot2.id, TU, B]);
const isToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date(Date.now() + 2 * 3600000)) === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());
if (isToday) await rejects(cancel(B, [sameDay.id]), /es hoy/, "same-day confirmed cancel");
await cancel(B, [sameDayPending.id]);

// 14. Only service_role runs the functions.
for (const fn of ["client_book_delivery(uuid,uuid[],uuid,luxury_finds.delivery_type,boolean)", "client_cancel_delivery(uuid,uuid[])", "confirm_delivery_request(uuid,uuid)", "reject_delivery_request(uuid,uuid,text)", "delivery_request_version()"]) {
  for (const role of ["authenticated", "anon"]) assert.equal((await one(`SELECT has_function_privilege('${role}', 'luxury_finds.${fn}', 'EXECUTE') ok`)).ok, false, `${role} ${fn}`);
  assert.equal((await one(`SELECT has_function_privilege('service_role', 'luxury_finds.${fn}', 'EXECUTE') ok`)).ok, true, `service_role ${fn}`);
}
console.log("delivery-requests: all checks passed");
