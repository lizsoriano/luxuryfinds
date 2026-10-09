// Migration 019 (client self-service delivery booking) against the real schema.
// Behaviour as of 019 only: 020 replaces it (see tests/delivery-requests.pglite.mjs).
// Run with Node 24 after installing PGlite in the ignored .tmp folder only:
//   npm install --prefix .tmp/pglite --no-package-lock @electric-sql/pglite
//   node tests/client-delivery-booking.pglite.mjs
// (or set PGLITE_DIR to any folder where @electric-sql/pglite is installed).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pgliteDir = process.env.PGLITE_DIR ?? path.resolve(import.meta.dirname, "../.tmp/pglite");
const { PGlite } = await import(pathToFileURL(path.join(pgliteDir, "node_modules/@electric-sql/pglite/dist/index.js")).href);

const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1), B = id(2), ADMIN = id(3);
const sql = (q, p) => db.query(q, p);
async function rejects(promise, pattern, label) {
  try { await promise; } catch (error) { assert.match(error.message, pattern, `${label}: ${error.message}`); return; }
  assert.fail(`${label}: should have failed`);
}

await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,allowed_mime_types text[]); CREATE TABLE storage.objects(name text,bucket_id text); CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS 'SELECT string_to_array(name,''/'')'; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
await db.exec(fs.readFileSync("database/schema.sql", "utf8").replace(/CREATE EXTENSION IF NOT EXISTS (citext|pgcrypto);/g, "").replace(/\bcitext\b/g, "text"));
for (const n of ["001", "002", "008", "009", "010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "019"]) {
  const file = fs.readdirSync("database/migrations").find((f) => f.startsWith(`${n}_`));
  await db.exec(fs.readFileSync(`database/migrations/${file}`, "utf8").replace(/\bcitext\b/g, "text"));
}
await db.exec("SET search_path TO luxury_finds, public");

// Business-local days (UTC-7).
const local = (offsetDays, hhmm) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
  return `${day}T${hhmm}:00-07:00`;
};

await sql("INSERT INTO auth.users VALUES ($1),($2),($3)", [A, B, ADMIN]);
await sql("INSERT INTO admin_users(id,username,display_name) VALUES ($1,'TEMP-admin','TEMP Admin')", [ADMIN]);
await sql("INSERT INTO clients(id,phone,first_name,last_name) VALUES ($1,'TEMP-1','Ana','Prueba'),($2,'TEMP-2','Bea','Prueba')", [A, B]);
await sql("INSERT INTO delivery_locations(id,name,address) VALUES ($1,'TEMP Punto','Calle 1')", [id(10)]);
// AV1: day+2 10:00-10:40, pickup only. AV2: day+3, both. AVT: today (notice rule).
const avs = [[id(11), 2, "10:00", 4, true, false], [id(12), 3, "16:00", 3, true, true], [id(13), 0, "23:00", 2, true, true]];
const slot = {};
for (const [av, day, start, count, pickup, didi] of avs) {
  const s = new Date(local(day, start));
  await sql("INSERT INTO delivery_availabilities(id,location_id,starts_at,ends_at,enabled_pickup,enabled_didi,created_by_admin_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [av, id(10), s.toISOString(), new Date(s.getTime() + count * 600000).toISOString(), pickup, didi, ADMIN]);
  for (let k = 0; k < count; k++) {
    const r = await sql("INSERT INTO delivery_slots(availability_id,starts_at,ends_at) VALUES ($1,$2,$3) RETURNING id", [av, new Date(s.getTime() + k * 600000).toISOString(), new Date(s.getTime() + (k + 1) * 600000).toISOString()]);
    slot[`${av.slice(-2)}-${k}`] = r.rows[0].id;
  }
}
async function ticket(n, client, status) {
  await sql("INSERT INTO orders(id,client_id,origin,status) VALUES ($1,$2,'ADMIN_MANUAL','CONFIRMED')", [id(100 + n), client]);
  await sql("INSERT INTO order_items(id,order_id,quantity,unit_price_cents) VALUES ($1,$2,1,10000)", [id(200 + n), id(100 + n)]);
  await sql("INSERT INTO tickets(id,order_item_id,client_id,product_name_snapshot,quantity,cash_unit_price_cents,agreed_total_cents,payment_mode,catalog_type_snapshot,logistics_status) VALUES ($1,$2,$3,$4,1,10000,10000,'FULL','ON_DEMAND',$5)", [id(300 + n), id(200 + n), client, `TEMP producto ${n}`, status]);
  return id(300 + n);
}
const T1 = await ticket(1, A, "READY_FOR_DELIVERY"), T2 = await ticket(2, A, "READY_FOR_DELIVERY"), T3 = await ticket(3, A, "IN_TRANSIT"), T4 = await ticket(4, A, "READY_FOR_DELIVERY");
const TB = await ticket(5, B, "READY_FOR_DELIVERY");
const book = (client, tickets, slotId, type = "PICKUP", re = false) => sql("SELECT * FROM client_book_delivery($1,$2::uuid[],$3,$4::delivery_type,$5)", [client, tickets, slotId, type, re]);
const cancel = (client, bookings) => sql("SELECT * FROM client_cancel_delivery($1,$2::uuid[])", [client, bookings]);
const status = async (t) => (await sql("SELECT logistics_status FROM tickets WHERE id=$1", [t])).rows[0].logistics_status;

// 1. A books T1 in the first slot.
const first = await book(A, [T1], slot["11-0"]);
assert.equal(first.rows.length, 1);
assert.equal(await status(T1), "DELIVERY_SCHEDULED");
assert.equal((await sql("SELECT count(*)::int c FROM activity_logs WHERE client_id=$1 AND action='DELIVERY_BOOKED_BY_CLIENT'", [A])).rows[0].c, 1);
// 2. Same slot for another client: one wins, the other is told it was taken.
await rejects(book(B, [TB], slot["11-0"]), /se acaba de ocupar/, "double booking");
// 3. Someone else's ticket.
await rejects(book(A, [TB], slot["11-3"]), /no pertenece/, "foreign ticket");
await rejects(book(B, [T2], slot["11-3"]), /no pertenece/, "foreign ticket B");
// 4. Not ready yet.
await rejects(book(A, [T3], slot["11-3"]), /no está listo/, "not ready");
// 5. Mode disabled in that availability.
await rejects(book(A, [T2], slot["11-3"], "DIDI"), /modalidad/, "didi disabled");
// 6. Minimum notice (today).
await rejects(book(A, [T2], slot["13-0"]), /anticipación/, "notice");
// 7. Two tickets take two consecutive slots.
const pair = await book(A, [T2, T4], slot["11-1"]);
assert.deepEqual(pair.rows.map((r) => r.r_slot_id).sort(), [slot["11-1"], slot["11-2"]].sort());
await rejects(book(B, [TB], slot["11-2"]), /se acaba de ocupar/, "second slot of a pair");
// 8. Not enough consecutive free slots.
await sql("UPDATE tickets SET logistics_status='READY_FOR_DELIVERY' WHERE id=$1", [T3]);
const T5 = await ticket(6, A, "READY_FOR_DELIVERY");
await rejects(book(A, [T3, T5], slot["11-3"]), /seguidos/, "consecutive");
// 9. Cancel: only her own, then the ticket is ready again.
const t1Booking = first.rows[0].r_booking_id;
await rejects(cancel(B, [t1Booking]), /no encontrada/, "foreign cancel");
await cancel(A, [t1Booking]);
assert.equal(await status(T1), "READY_FOR_DELIVERY");
assert.equal((await sql("SELECT status, cancellation_reason FROM delivery_bookings WHERE id=$1", [t1Booking])).rows[0].status, "CANCELLED");
await rejects(cancel(A, [t1Booking]), /ya no está activa/, "cancel twice");
// 10. The freed slot can be taken by B now.
await book(B, [TB], slot["11-0"]);
// 11. Reschedule the pair to day+3 by DiDi, atomically.
const moved = await book(A, [T2, T4], slot["12-0"], "DIDI", true);
assert.equal(moved.rows.length, 2);
assert.equal((await sql("SELECT count(*)::int c FROM delivery_bookings WHERE ticket_id = ANY($1::uuid[]) AND status='BOOKED'", [[T2, T4]])).rows[0].c, 2);
assert.equal((await sql("SELECT count(*)::int c FROM delivery_bookings WHERE slot_id = ANY($1::uuid[]) AND status='BOOKED'", [[slot["11-1"], slot["11-2"]]])).rows[0].c, 0);
assert.equal(await status(T2), "DELIVERY_SCHEDULED");
// Without p_reschedule a scheduled ticket cannot be booked again.
await rejects(book(A, [T2], slot["12-2"]), /no está listo/, "rebook without reschedule");
// 12. Same-day appointments cannot be changed online.
const sameDay = await sql("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type) VALUES ($1,$2,$3,'PICKUP') RETURNING id", [slot["13-0"], T5, A]);
await rejects(cancel(A, [sameDay.rows[0].id]), /es hoy/, "same-day cancel");
// 13. The unique index is still the last line of defence.
await rejects(sql("INSERT INTO delivery_bookings(slot_id,ticket_id,client_id,delivery_type) VALUES ($1,$2,$3,'PICKUP')", [slot["12-0"], T3, A]), /uq_delivery_slot_active|duplicate/, "unique index");
// 14. Browsers cannot call the functions.
for (const fn of ["client_book_delivery(uuid,uuid[],uuid,luxury_finds.delivery_type,boolean)", "client_cancel_delivery(uuid,uuid[])"]) {
  assert.equal((await sql(`SELECT has_function_privilege('authenticated', 'luxury_finds.${fn}', 'EXECUTE') ok`)).rows[0].ok, false);
  assert.equal((await sql(`SELECT has_function_privilege('anon', 'luxury_finds.${fn}', 'EXECUTE') ok`)).rows[0].ok, false);
  assert.equal((await sql(`SELECT has_function_privilege('service_role', 'luxury_finds.${fn}', 'EXECUTE') ok`)).rows[0].ok, true);
}
console.log("client-delivery-booking: all checks passed");
