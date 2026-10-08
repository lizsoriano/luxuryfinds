// Run with Node 24 after installing @electric-sql/pglite in .tmp/pglite only:
// npm install --prefix .tmp/pglite --no-package-lock @electric-sql/pglite
// node tests/sales-feed.pglite.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "../.tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js";
import { buildSaleIndexRow, buildOrderIndexRow, countIndexRows, pageIndexRows, orderPayment, orderStage, orderToCollect, salePayment, salesCsvCell } from "../lib/sales-feed.ts";

const db = new PGlite();
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA luxury_finds; SET search_path TO luxury_finds,public;
    CREATE TABLE clients(id uuid PRIMARY KEY,first_name text,last_name text,phone text);
    CREATE TABLE admin_users(id uuid PRIMARY KEY);
    CREATE TABLE sales(id uuid PRIMARY KEY,sale_number text,sold_at timestamptz,client_id uuid,status text,concept text);
    CREATE TABLE sale_items(id uuid PRIMARY KEY,sale_id uuid,product_name_snapshot text,variant_name_snapshot text,sku_snapshot text);
    CREATE TABLE orders(id uuid PRIMARY KEY,created_at timestamptz,client_id uuid,status text);
    CREATE TABLE products(id uuid PRIMARY KEY,name text);
    CREATE TABLE product_variants(id uuid PRIMARY KEY,name text);
    CREATE TABLE order_items(id uuid PRIMARY KEY,order_id uuid,product_id uuid,variant_id uuid);
    CREATE TABLE tickets(id uuid PRIMARY KEY,order_item_id uuid,logistics_status text,agreed_total_cents bigint,paid_principal_cents bigint,ticket_number text,product_name_snapshot text,variant_name_snapshot text);
    GRANT USAGE ON SCHEMA luxury_finds TO anon,authenticated,service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA luxury_finds TO service_role;`);
  const migration = await readFile(new URL("../database/migrations/017_sales_feed_tracking.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration); // idempotency, including dependent views
  const client = { first_name: "María", last_name: "Muñoz", phone: "TEMP-555" };
  await db.query("INSERT INTO clients VALUES ($1,$2,$3,$4)", [uuid(1), ...Object.values(client)]);
  const pure = [];
  for (let n = 0; n < 25; n++) {
    const sale = { id: uuid(100 + n), sale_number: `TEMP-${n}`, sold_at: new Date(Date.UTC(2026, 9, 1, n)).toISOString(), client_id: n === 0 ? null : uuid(1), status: n === 1 ? "CANCELLED" : "COMPLETED", concept: "Árbol" };
    const item = { product_name_snapshot: "Perfume", variant_name_snapshot: "Rosa", sku_snapshot: "TEMP-SKU" };
    await db.query("INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6)", Object.values(sale));
    await db.query("INSERT INTO sale_items VALUES ($1,$2,$3,$4,$5)", [uuid(200 + n), sale.id, ...Object.values(item)]);
    pure.push(buildSaleIndexRow(sale, sale.client_id ? client : null, [item]));
  }
  const states = ["DRAFT", "CONFIRMED", "CONFIRMED", "CONFIRMED", "COMPLETED", "CANCELLED", "CONFIRMED"];
  const logistics = [[], ["WAITING_TO_ORDER", "DELIVERED"], ["ORDERED", "CANCELLED_INCIDENT"], ["READY_FOR_DELIVERY"], ["DELIVERED"], ["CANCELLED_INCIDENT"], ["CANCELLED_INCIDENT"]];
  for (let n = 0; n < states.length; n++) {
    const order = { id: uuid(300 + n), created_at: new Date(Date.UTC(2026, 9, 1, n * 3, 30)).toISOString(), client_id: uuid(1), status: states[n] };
    await db.query("INSERT INTO orders VALUES ($1,$2,$3,$4)", Object.values(order));
    const lines = [];
    for (let k = 0; k < Math.max(1, logistics[n].length); k++) {
      const itemId = uuid(400 + n * 10 + k);
      // Shopper items deliberately have neither product nor variant.
      await db.query("INSERT INTO order_items VALUES ($1,$2,NULL,NULL)", [itemId, order.id]);
      let ticket = null;
      if (logistics[n][k]) {
        ticket = { logistics_status: logistics[n][k], agreed_total_cents: "10000", paid_principal_cents: n === 4 ? "10000" : "2500", ticket_number: `TEMP-T-${n}-${k}`, product_name_snapshot: "Compra shopper", variant_name_snapshot: null };
        await db.query("INSERT INTO tickets VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [uuid(500 + n * 10 + k), itemId, ...Object.values(ticket)]);
      }
      lines.push({ product_name: null, variant_name: null, ticket });
    }
    pure.push(buildOrderIndexRow(order, client, lines));
  }
  const sql = (await db.query("SELECT * FROM sales_feed ORDER BY occurred_at DESC,id DESC,kind")).rows;
  const normalized = sql.map(row => ({ ...row, occurred_at: new Date(row.occurred_at).toISOString() }));
  const page = pageIndexRows(pure, { page: 1, pageSize: 100 });
  assert.deepEqual(normalized, page.rows);
  const counts = (await db.query("SELECT * FROM sales_feed_counts")).rows[0];
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([k,v]) => [k,Number(v)])), countIndexRows(pure));
  for (const ascending of [false,true]) for (const filter of ["todas","por-confirmar","por-cobrar","por-ordenar","en-camino","listas","entregadas","canceladas"]) {
    const fromPure = pageIndexRows(pure, { filter, ascending, page: 1, pageSize: 100 }).rows;
    assert.equal(new Set(fromPure.map(r => r.kind + r.id)).size, fromPure.length);
    const where = { todas: "true", "por-confirmar": "stage='TO_CONFIRM'", "por-cobrar": "to_collect AND stage<>'CANCELLED'", "por-ordenar": "stage='TO_ORDER'", "en-camino": "stage='IN_TRANSIT'", listas: "stage='READY'", entregadas: "stage='DELIVERED'", canceladas: "stage='CANCELLED'" }[filter];
    const direction = ascending ? "ASC" : "DESC";
    const filteredSql = (await db.query(`SELECT * FROM sales_feed WHERE ${where} ORDER BY occurred_at ${direction},id ${direction},kind`)).rows.map(row => ({ ...row, occurred_at: new Date(row.occurred_at).toISOString() }));
    assert.deepEqual(filteredSql, fromPure);
  }
  const first = pageIndexRows(pure, { page: 1, pageSize: 20 });
  const second = pageIndexRows(pure, { page: 2, pageSize: 20 });
  assert.equal(first.rows.length, 20); assert.equal(second.rows.length, 12);
  assert.equal(new Set([...first.rows,...second.rows].map(r => r.kind + r.id)).size, 32);
  assert.equal(pageIndexRows(pure, { search: "maria munoz", page: 1, pageSize: 100 }).rows.length, 31);
  assert.equal(pageIndexRows(pure, { search: "shopper", page: 1, pageSize: 100 }).rows.length, 6);
  assert.equal(orderStage("CONFIRMED", [{ logistics_status: "IN_TRANSIT", agreed_total_cents: 1, paid_principal_cents: 0 }, { logistics_status: "CANCELLED_INCIDENT", agreed_total_cents: 1, paid_principal_cents: 0 }]), "IN_TRANSIT");
  const refunded = orderPayment({ orderStatus: "CANCELLED", stage: "CANCELLED", tickets: [{ logistics_status: "CANCELLED_INCIDENT", financial_status: "REFUNDED", agreed_total_cents: 10000, paid_principal_cents: 2500 }], refundedCents: 2500, pendingProofs: 0, methods: ["TRANSFER"], planWeeks: 4, requestedWeeks: null });
  assert.deepEqual(refunded.badges.map(b => b.label), ["Cancelada", "Reembolsado"]);
  assert.match(refunded.methodText, /Plan semanal 4 sem/);
  assert.equal(orderToCollect("CONFIRMED", [{ logistics_status: "IN_TRANSIT", agreed_total_cents: "9007199254740993", paid_principal_cents: "9007199254740992" }]), true);
  assert.equal(salesCsvCell('  =SUM(1,2)'), '"\'  =SUM(1,2)"');
  assert.equal(salesCsvCell('María "Rosa"'), '"María ""Rosa"""');
  assert.deepEqual(salePayment({ status: "CANCELLED", payment_method: "CASH", sale_type: "PRODUCT" }).badges.map(b => b.label), ["Cancelada"]);
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sale_tracking_links(token,sale_id) VALUES ($1,$2)", [token,uuid(100)]);
  await assert.rejects(db.query("INSERT INTO sale_tracking_links(token,sale_id) VALUES ('short',$1)", [uuid(101)]));
  await assert.rejects(db.query("INSERT INTO sale_tracking_links(token,sale_id,order_id) VALUES ($1,$2,$3)", [randomBytes(32).toString("base64url"),uuid(101),uuid(300)]));
  await assert.rejects(db.query("INSERT INTO sale_tracking_links(token,sale_id) VALUES ($1,$2)", [randomBytes(32).toString("base64url"),uuid(100)]));
  await db.query("UPDATE sale_tracking_links SET revoked_at=now() WHERE token=$1", [token]);
  assert.equal((await db.query("SELECT token FROM sale_tracking_links WHERE token=$1 AND revoked_at IS NULL", [token])).rows.length, 0);
  await db.query("INSERT INTO sale_tracking_links(token,sale_id) VALUES ($1,$2)", [randomBytes(32).toString("base64url"),uuid(100)]);
  for (const role of ["anon","authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    for (const table of ["sales_feed","sales_feed_counts","sale_tracking_links"]) await assert.rejects(db.query(`SELECT * FROM luxury_finds.${table}`));
    await db.exec("RESET ROLE");
  }
  await db.exec("SET ROLE service_role");
  assert.equal((await db.query("SELECT * FROM luxury_finds.sales_feed")).rows.length, 32);
  assert.equal((await db.query("SELECT * FROM luxury_finds.sale_tracking_links WHERE revoked_at IS NULL")).rows.length, 1);
  await db.exec("RESET ROLE");
  console.log("PASS: SQL/TypeScript parity, mixed ordering, pagination, shopper, no client, weekly refund, idempotency, token constraints/revocation and access grants.");
} finally { await db.close(); }
