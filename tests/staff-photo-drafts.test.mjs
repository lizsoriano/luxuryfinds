// Photo-first staff products: the browser queue (retries, persistence, batch
// never stops) and the idempotent server creation (clientRef = product id).
// Run: node --test tests/staff-photo-drafts.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import * as drafts from '../lib/staff-photo-drafts.ts';
import { STAFF_SELECTS } from '../lib/supabase/staff-schema.ts';

const { PhotoDraftQueue, nextOp, missingFields, fieldErrors, parsePriceCents, parseQuantity, provisionalProductName, brandIndex, EMPTY_VALUES } = drafts;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 3000) { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await tick(5); } }

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test('validation matches the staff edit rules', () => {
  assert.equal(parsePriceCents('150'), 15000);
  assert.equal(parsePriceCents('$1,250.5'), 125050);
  for (const bad of ['0', '0.001', '1.234', 'abc', '', '-5']) assert.equal(parsePriceCents(bad), null, bad);
  assert.equal(parseQuantity('3'), 3);
  for (const bad of ['0', '1.5', '-1', 'x', '']) assert.equal(parseQuantity(bad), null, bad);
  const brands = brandIndex([{ id: 'b1', name: 'Sephora Favorites' }]);
  assert.equal(fieldErrors({ ...EMPTY_VALUES, brand: 'sephora favorites' }, brands).brand, undefined);
  assert.match(fieldErrors({ ...EMPTY_VALUES, brand: 'Marca Nueva' }, brands).brand, /lista/);
  assert.deepEqual(missingFields(EMPTY_VALUES), ['nombre', 'precio', 'cantidad']);
  assert.deepEqual(missingFields({ ...EMPTY_VALUES, name: 'Labial', price: '150', quantity: '2' }), []);
  assert.equal(provisionalProductName(new Date('2026-10-05T08:23:00Z'), 3), 'Producto sin nombre · 05 oct 01:23 · #3');
});

test('edits go out in a safe order and never give stock to a $0 product', () => {
  const brands = brandIndex([{ id: 'b1', name: 'Dior' }]);
  const saved = { name: 'Producto sin nombre', categoryId: null, brandId: null, variant: 'Único', priceCents: 0, quantity: 0 };
  const base = { productId: 'p', variantId: 'v', photo: null, photoReady: true, saved };
  const values = { ...EMPTY_VALUES, name: 'Labial', brand: 'Dior', price: '150', quantity: '2' };
  assert.deepEqual(nextOp({ ...base }, brands, values), { kind: 'product', name: 'Labial', categoryId: null, brandId: 'b1' });
  const named = { ...saved, name: 'Labial', brandId: 'b1' };
  assert.deepEqual(nextOp({ ...base, saved: named }, brands, values), { kind: 'price', priceCents: 15000 });
  // Quantity typed but no price yet: nothing to send (stock waits for the price).
  assert.equal(nextOp({ ...base, saved: named }, brands, { ...values, price: '' }), null);
  const priced = { ...named, priceCents: 15000 };
  assert.deepEqual(nextOp({ ...base, saved: priced }, brands, values), { kind: 'entry', quantity: 2, expectedStock: 0 });
  assert.deepEqual(nextOp({ ...base, saved: { ...priced, quantity: 2 } }, brands, { ...values, quantity: '5' }), { kind: 'stock', quantity: 5 });
  assert.equal(nextOp({ ...base, saved: { ...priced, quantity: 2 } }, brands, values), null);
  // Not created yet: only the creation, and only once the photo is compressed.
  assert.deepEqual(nextOp({ productId: null, photo: {}, photoReady: true, saved: null }, brands, values), { kind: 'create' });
  assert.equal(nextOp({ productId: null, photo: {}, photoReady: false, saved: null }, brands, values), null);
});

// ---------------------------------------------------------------------------
// The queue against a fake server that behaves like the real one
// ---------------------------------------------------------------------------

function fakeServer() {
  const products = new Map();
  const movements = [];
  const faults = [];
  let calls = 0;
  /** mode: 'before' = request never arrives; 'after' = applied, response lost; 'error' = server answers an error. */
  const fault = () => { const next = faults.shift(); return next ?? null; };
  async function execute(op, draft) {
    calls += 1;
    await tick(1);
    const f = fault();
    if (f === 'before') throw new TypeError('Failed to fetch');
    if (f === 'error') return { ok: false, error: 'La base de datos no respondió.' };
    let result;
    if (op.kind === 'create') {
      if (!products.has(draft.id)) products.set(draft.id, { id: draft.id, name: draft.provisionalName, price: 0, stock: 0, brandId: null });
      result = { ok: true, patch: { productId: draft.id, variantId: `v-${draft.id}`, imageUrl: null } };
    } else {
      const product = products.get(draft.productId);
      if (op.kind === 'product') Object.assign(product, { name: op.name, brandId: op.brandId });
      if (op.kind === 'price') product.price = op.priceCents;
      if (op.kind === 'entry') {
        if (product.price <= 0) return { ok: false, error: 'precio primero' };
        if (product.stock === op.expectedStock + op.quantity) result = { ok: true };
        else if (product.stock !== op.expectedStock) return { ok: false, error: 'cambió' };
        else { product.stock += op.quantity; movements.push({ type: 'RECEIPT', productId: product.id, quantity: op.quantity }); }
      }
      if (op.kind === 'stock') { movements.push({ type: 'MANUAL_ADJUSTMENT', productId: product.id, quantity: op.quantity - product.stock }); product.stock = op.quantity; }
      result ??= { ok: true };
    }
    if (f === 'after') throw new TypeError('Failed to fetch');
    return result;
  }
  return { products, movements, faults, execute, get calls() { return calls; } };
}

function makeQueue(server, storage = new Map(), extra = {}) {
  const queue = new PhotoDraftQueue({
    execute: server.execute,
    prepare: async (draft) => { await tick(1); if (draft.photo.broken) throw new Error('No pudimos leer esa foto.'); return { compressed: true, size: 10 }; },
    save: async (draft) => { storage.set(draft.id, structuredClone({ ...draft, photo: draft.photo ? { ...draft.photo } : null })); },
    drop: async (id) => { storage.delete(id); },
    brands: () => brandIndex([{ id: 'b1', name: 'Dior' }]),
    retryDelays: [5, 10],
    idleCommitMs: 40,
    persistDebounceMs: 1,
    ...extra,
  });
  return { queue, storage };
}

let counter = 0;
function photoDraft(seq, photo = { original: true }) {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  return { id, actorId: 'staff', createdAt: Date.now(), seq, provisionalName: `Producto sin nombre · #${seq}`, photo, photoReady: false, photoKey: id, productId: null, variantId: null, imageUrl: null, values: { ...EMPTY_VALUES }, saved: null };
}

test('a photo with nothing typed becomes a product with defaults by itself', async () => {
  const server = fakeServer();
  const { queue, storage } = makeQueue(server);
  for (let seq = 1; seq <= 3; seq += 1) queue.add(photoDraft(seq));
  assert.equal(queue.hasUnsaved(), true);
  await until(() => queue.drafts.every((draft) => draft.productId) && !queue.busy());
  assert.equal(server.products.size, 3);
  for (const draft of queue.drafts) {
    assert.deepEqual(draft.saved, { name: draft.provisionalName, categoryId: null, brandId: null, variant: 'Único', priceCents: 0, quantity: 0 });
    // Still on the device (it lacks name/price/quantity) but without the photo bytes.
    assert.equal(storage.get(draft.id).photo, null);
  }
  assert.equal(server.movements.length, 0);
  assert.deepEqual({ saved: queue.summary().saved, missing: queue.summary().missing, errors: queue.summary().errors.length }, { saved: 3, missing: 3, errors: 0 });
  assert.equal(queue.hasUnsaved(), false);
});

test('a cut connection is retried with backoff and never duplicates (lost request and lost response)', async () => {
  const server = fakeServer();
  server.faults.push('before', 'after');
  const { queue } = makeQueue(server);
  queue.add(photoDraft(1));
  await until(() => queue.drafts[0].productId && !queue.busy());
  assert.equal(server.calls, 3);
  assert.equal(server.products.size, 1);
  assert.equal(queue.drafts[0].rt.phase, 'idle');
});

test('the batch never stops: a failing product ends in "error" with its reason, the rest are saved, Reintentar works', async () => {
  const server = fakeServer();
  // Draft 2 fails three times in a row (all its attempts); the others are fine.
  const original = server.execute;
  let failing = null;
  let failures = 0;
  const flaky = async (op, draft) => { if (draft.id === failing && failures < 3) { failures += 1; await tick(1); return { ok: false, error: 'La base de datos no respondió.' }; } return original(op, draft); };
  const { queue } = makeQueue({ ...server, execute: flaky });
  const rows = [photoDraft(1), photoDraft(2), photoDraft(3), photoDraft(4)];
  failing = rows[1].id;
  rows.forEach((row) => queue.add(row));
  await until(() => !queue.busy() && queue.drafts.filter((draft) => draft.productId).length === 3);
  const summary = queue.summary();
  assert.equal(summary.saved, 3);
  assert.equal(summary.errors.length, 1);
  assert.deepEqual(summary.errors[0], { id: rows[1].id, label: 'Producto 2', error: 'La base de datos no respondió.' });
  assert.equal(queue.hasUnsaved(), true);
  queue.retry(rows[1].id);
  await until(() => queue.drafts.every((draft) => draft.productId) && !queue.busy());
  assert.equal(server.products.size, 4);
});

test('typed data is sent only when she leaves the field (or after the idle wait), in order, with one RECEIPT', async () => {
  const server = fakeServer();
  const { queue, storage } = makeQueue(server);
  const row = photoDraft(1);
  queue.add(row);
  await until(() => queue.drafts[0].productId && !queue.busy());
  queue.edit(row.id, 'name', 'Labial Rouge');
  queue.edit(row.id, 'brand', 'Dior');
  queue.edit(row.id, 'quantity', '2');
  await tick(10);
  assert.equal(server.products.get(row.id).name, row.provisionalName, 'nothing sent while typing');
  queue.edit(row.id, 'price', '1'); // she is still typing "150"
  queue.edit(row.id, 'price', '150');
  queue.commit(row.id); // blur
  await until(() => !queue.busy() && server.products.get(row.id).stock === 2);
  const product = server.products.get(row.id);
  assert.deepEqual({ name: product.name, brandId: product.brandId, price: product.price, stock: product.stock }, { name: 'Labial Rouge', brandId: 'b1', price: 15000, stock: 2 });
  assert.equal(server.movements.length, 1);
  assert.equal(server.movements[0].type, 'RECEIPT');
  // Complete and saved: the device copy is gone.
  await until(() => !storage.has(row.id));
  assert.equal(queue.summary().missing, 0);
  // The idle wait also commits without a blur.
  queue.edit(row.id, 'quantity', '3');
  await until(() => server.products.get(row.id).stock === 3);
  assert.equal(server.movements[1].type, 'MANUAL_ADJUSTMENT');
});

test('a lost response on the first entry does not double the stock', async () => {
  const server = fakeServer();
  const { queue } = makeQueue(server);
  const row = photoDraft(1);
  queue.add(row);
  await until(() => queue.drafts[0].productId && !queue.busy());
  queue.edit(row.id, 'price', '99');
  queue.commit(row.id);
  await until(() => !queue.busy() && server.products.get(row.id).price === 9900);
  server.faults.push('after');
  queue.edit(row.id, 'quantity', '4');
  queue.commit(row.id);
  await until(() => !queue.busy() && queue.drafts[0].saved.quantity === 4);
  assert.equal(server.products.get(row.id).stock, 4);
  assert.equal(server.movements.length, 1);
});

test('reload: unsent photos and unsaved edits come back from the device and continue, without duplicates', async () => {
  const server = fakeServer();
  server.faults.push('before', 'before', 'before'); // first draft: three attempts fail → error
  const { queue, storage } = makeQueue(server);
  const a = photoDraft(1);
  const b = photoDraft(2);
  queue.add(a);
  await until(() => queue.drafts[0].rt.phase === 'error');
  queue.add(b);
  queue.edit(b.id, 'name', 'Perfume');
  await queue.persistPending();
  // "Close the tab" before b was uploaded.
  queue.dispose();
  assert.equal(storage.size, 2);
  assert.equal(server.products.size, 0);

  // A new page: a new queue restores from the same device storage.
  const reopened = makeQueue(server, storage).queue;
  const restored = reopened.load([...storage.values()]);
  assert.equal(restored, 2);
  await until(() => reopened.drafts.every((draft) => draft.productId) && !reopened.busy() && server.products.get(b.id)?.name === 'Perfume');
  assert.equal(server.products.size, 2);
  // Restoring the same rows again (e.g. a second tab) is a no-op.
  assert.equal(reopened.load([...storage.values()]), 0);
});

test('an unreadable photo stays as an error card and does not block the others', async () => {
  const server = fakeServer();
  const { queue } = makeQueue(server);
  queue.add(photoDraft(1, { broken: true }));
  queue.add(photoDraft(2));
  await until(() => queue.drafts[1].productId && !queue.busy());
  assert.equal(queue.drafts[0].rt.phase, 'error');
  assert.match(queue.drafts[0].rt.error, /leer esa foto/);
  assert.equal(queue.summary().errors.length, 1);
});

test('a device storage failure is shown but the upload continues', async () => {
  const server = fakeServer();
  const { queue } = makeQueue(server, new Map(), { save: async () => { throw new Error('QuotaExceededError'); } });
  queue.add(photoDraft(1));
  await until(() => queue.drafts[0].rt.localError);
  await until(() => queue.drafts[0].productId && !queue.busy());
  assert.equal(server.products.size, 1);
});

// ---------------------------------------------------------------------------
// Server: createStaffProduct with clientRef/draft over an in-memory PostgREST
// that enforces the real constraints (PK, UNIQUE, FK) and interleaves awaits.
// ---------------------------------------------------------------------------

function fakeDb() {
  const tables = { products: [], product_variants: [], product_images: [], activity_logs: [], brands: [{ id: 'brand-1', name: 'Dior' }], categories: [], inventory_movements: [] };
  const objects = new Set();
  const unique = { products: [['id'], ['slug']], product_variants: [['product_id', 'name']], product_images: [['storage_key']] };
  const pause = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
  function from(table) {
    const filters = [];
    let mode = 'select';
    let payload = null;
    let columns = '';
    let limit = Infinity;
    const q = {
      select(cols = '*') { columns = cols; return q; },
      insert(rows) { mode = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return q; },
      update(change) { mode = 'update'; payload = change; return q; },
      delete() { mode = 'delete'; return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      order() { return q; },
      range() { return q; },
      limit(n) { limit = n; return q; },
      async run() {
        await pause();
        const rows = tables[table];
        const match = (row) => filters.every(([key, value]) => row[key] === value);
        if (mode === 'insert') {
          for (const row of payload) {
            for (const cols of unique[table] ?? []) {
              if (cols.every((col) => row[col] !== undefined) && rows.some((existing) => cols.every((col) => existing[col] === row[col]))) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_${cols.join('_')}"` } };
            }
            if (table === 'product_variants' && !tables.products.some((p) => p.id === row.product_id)) return { data: null, error: { code: '23503', message: 'violates foreign key constraint' } };
          }
          const inserted = payload.map((row) => ({ id: row.id ?? `${table}-${rows.length + 1}-${Math.random().toString(16).slice(2, 6)}`, ...row }));
          rows.push(...inserted);
          return { data: inserted, error: null };
        }
        if (mode === 'delete') { const keep = rows.filter((row) => !match(row)); if (table === 'products') { const gone = rows.filter(match).map((row) => row.id); tables.product_variants = tables.product_variants.filter((v) => !gone.includes(v.product_id)); tables.product_images = tables.product_images.filter((i) => !gone.includes(i.product_id)); } tables[table] = keep; return { data: null, error: null }; }
        let data = rows.filter(match).slice(0, limit).map((row) => ({ ...row }));
        if (table === 'products' && columns.includes('product_variants')) data = data.map((row) => ({ ...row, product_variants: tables.product_variants.filter((v) => v.product_id === row.id), product_images: tables.product_images.filter((i) => i.product_id === row.id) }));
        return { data, error: null };
      },
      async single() { const r = await q.run(); return r.error ? r : { data: r.data[0] ?? null, error: r.data.length ? null : { message: 'no rows' } }; },
      async maybeSingle() { const r = await q.run(); return r.error ? r : { data: r.data[0] ?? null, error: null }; },
      then(resolve, reject) { return q.run().then(resolve, reject); },
    };
    return q;
  }
  const storage = { from: () => ({
    async upload(key) { await pause(); if (objects.has(key)) return { error: { statusCode: '409', message: 'The resource already exists' } }; objects.add(key); return { error: null }; },
    async remove(keys) { keys.forEach((key) => objects.delete(key)); return { error: null }; },
  }) };
  return { tables, objects, db: { from }, storage };
}

function loadStaffInventory(fake) {
  const source = fs.readFileSync('lib/supabase/staff-inventory.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mocks = {
    '../actions': { describeError: (error, fallback) => error?.message ?? fallback },
    '../format': { slugify: (text) => text.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') },
    '../staff-photo-drafts': drafts,
    './admin-catalog': {
      ensureUniqueSlug: async (_table, base) => { let candidate = base; let n = 1; while (fake.tables.products.some((p) => p.slug === candidate)) candidate = `${base}-${++n}`; return candidate; },
      recordManualMovement: async (input) => { fake.tables.inventory_movements.push(input); return { ok: true, movementId: 'm' }; },
      getStockFor: async () => new Map(), productImageUrl: (key) => key, updateVariantQuick: async () => ({ ok: true }),
    },
    './business': {
      adminDb: () => fake.db, adminStorage: () => fake.storage, PRODUCT_IMAGE_BUCKET: 'catalog', EXPENSE_RECEIPT_BUCKET: 'receipts', MAX_PRODUCT_IMAGES: 3,
      logActivity: async (input) => { fake.tables.activity_logs.push({ action: input.action, entity_id: input.entityId, new_data: input.newData }); },
    },
    './in-transit': {}, './staff-schema': { STAFF_SELECTS, STAFF_DELIVERIES_MIGRATION_FILE: '', isMissingStaffDeliverySchema: () => false },
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(code, { module: sandboxModule, exports: sandboxModule.exports, require: (path) => mocks[path] ?? {}, setTimeout: (fn) => setTimeout(fn, 1), console, Date, Number, Map, Set, File, crypto, Math, Intl, String, Array, Object, Promise, JSON, Error, RegExp });
  return sandboxModule.exports;
}

const photo = () => new File([new Uint8Array(2048)], 'foto.jpg', { type: 'image/jpeg' });
const ref = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const draftInput = (extra = {}) => ({ adminId: 'staff', name: 'Producto sin nombre · 05 oct 01:23 · #1', categoryId: null, variants: [{ name: 'X', priceCents: 999, quantity: 9 }], photo: photo(), clientRef: ref, draft: true, ...extra });

test('server draft: only the photo is required; defaults $0, stock 0, no movement, hidden, client_ref audited', async () => {
  const fake = fakeDb();
  const api = loadStaffInventory(fake);
  const result = await api.createStaffProduct(draftInput());
  assert.equal(result.ok, true, result.error);
  assert.equal(result.productId, ref);
  const [product] = fake.tables.products;
  assert.equal(product.is_public, false);
  assert.equal(product.catalog_type, 'IMMEDIATE');
  assert.deepEqual(fake.tables.product_variants.map((v) => [v.name, v.price_cents]), [['Único', 0]]);
  assert.equal(result.variantId, fake.tables.product_variants[0].id);
  assert.equal(fake.tables.inventory_movements.length, 0);
  assert.equal(fake.tables.product_images.length, 1);
  assert.equal(fake.tables.activity_logs[0].new_data.client_ref, ref);
  assert.equal((await api.createStaffProduct(draftInput({ photo: null }))).ok, false, 'a draft needs its photo');
  assert.equal((await api.createStaffProduct(draftInput({ clientRef: 'not-a-uuid' }))).ok, false);
  // Without draft the old validation is intact ($0 refused).
  assert.equal((await api.createStaffProduct({ adminId: 'staff', name: 'Normal', categoryId: null, variants: [{ name: 'Único', priceCents: 0, quantity: 1 }] })).ok, false);
  assert.match((await api.createStaffProduct(draftInput({ clientRef: '7f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b', brandId: 'no-such-brand' }))).error, /marca/);
});

test('server: a repeated clientRef returns the same product (sequential retry and simultaneous requests)', async () => {
  const fake = fakeDb();
  const api = loadStaffInventory(fake);
  const first = await api.createStaffProduct(draftInput());
  const again = await api.createStaffProduct(draftInput());
  assert.equal(again.ok, true);
  assert.equal(again.productId, first.productId);
  assert.equal(again.variantId, first.variantId);
  assert.match(again.message, /no se duplicó/);
  assert.equal(fake.tables.products.length, 1);
  assert.equal(fake.tables.activity_logs.length, 1);

  for (let round = 0; round < 25; round += 1) {
    const race = fakeDb();
    const raceApi = loadStaffInventory(race);
    const results = await Promise.all([raceApi.createStaffProduct(draftInput()), raceApi.createStaffProduct(draftInput()), raceApi.createStaffProduct(draftInput())]);
    assert.ok(results.every((result) => result.ok && result.productId === ref), JSON.stringify(results));
    assert.equal(race.tables.products.length, 1);
    assert.equal(race.tables.product_variants.length, 1);
    assert.equal(race.tables.product_images.length, 1);
    assert.equal(race.objects.size, 1);
    assert.ok(results.every((result) => result.variantId === race.tables.product_variants[0].id));
  }
});

test('server: resuming a creation cut between the product and its variant completes it once', async () => {
  const fake = fakeDb();
  const api = loadStaffInventory(fake);
  fake.tables.products.push({ id: ref, name: 'Producto sin nombre', slug: 'producto-sin-nombre', catalog_type: 'IMMEDIATE', is_active: true, is_public: false, created_by_admin_id: 'staff' });
  const result = await api.createStaffProduct(draftInput());
  assert.equal(result.ok, true);
  assert.equal(fake.tables.product_variants.length, 1);
  assert.equal(fake.tables.product_variants[0].price_cents, 0);
  assert.equal(fake.tables.product_images.length, 1);
  assert.equal(fake.tables.activity_logs.length, 1);
  // Someone else's product with that id is never touched.
  const other = await api.createStaffProduct(draftInput({ adminId: 'other' }));
  assert.equal(other.ok, false);
});
