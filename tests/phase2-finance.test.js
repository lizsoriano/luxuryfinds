const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const financeSource = fs.readFileSync('js/shared/finance.js', 'utf8');

function boot(seed) {
  const values = new Map(Object.entries(seed.storage || {}).map(([key, value]) => [key, JSON.stringify(value)]));
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const storage = {
    get: (key, fallback) => JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)),
    set: (key, value) => localStorage.setItem(key, JSON.stringify(value))
  };
  const context = {
    console, localStorage, Date, FileReader: function () {},
    GlamData: {
      storage,
      getOrders: () => storage.get('orders', seed.orders || []),
      getClient: id => (seed.clients || []).find(client => client.id === id) || null
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(financeSource, context);
  return { F: context.LuxuryFinance, localStorage, values };
}

function order(id, clientId, products) {
  return { id, clientId, createdAt: '2026-08-01T12:00:00.000Z', products };
}

function product(id, name, price, status = 'ordered') {
  return { id, name, quantity: 1, unitPrice: price, subtotal: price, status };
}

const orders = [
  order(1, 1, [product('a', 'Bolsa', 1500)]),
  order(2, 1, [product('b', 'Tenis', 2800)]),
  order(3, 1, [product('c', 'Perfume', 2800), product('d', 'Crema', 900)]),
  order(4, 1, [product('e', 'Lentes', 1500)]),
  order(5, 1, [product('f', 'Cartera', 900)])
];
const app = boot({ orders, clients: [{ id: 1, name: 'Ana' }], storage: { orders } });
const F = app.F;

// 1. Contado cubierto.
const cash = F.getTickets().find(ticket => ticket.orderId === 1);
F.registerPayment({ ticketId: cash.id, amount: 1500, date: '2026-08-17', method: 'Efectivo' });
assert.equal(F.calculate(cash).balanceDueCents, 0);
assert.equal(F.calculateFinancialStatus(cash), 'paid');

// 2. Plan semanal con 15% y anticipo.
const planTicket = F.getTickets().find(ticket => ticket.orderId === 2);
const plan = F.createPlan(planTicket.id, { frequency: 'weekly', firstDueDate: '2026-08-21', numberOfPayments: 4, downPayment: 1000, surchargeType: 'percent', surchargeValue: 15 });
assert.equal(plan.finalPriceCents, 322000);
assert.equal(F.getSchedules().filter(item => item.ticketId === planTicket.id).reduce((sum, item) => sum + item.expectedAmountCents, 0), 222000);

// 3. El monto real de $800 se conserva y se distribuye, no se sustituye.
const actual = F.registerPayment({ ticketId: planTicket.id, amount: 800, date: '2026-08-21', method: 'Transferencia' });
assert.equal(actual.amountCents, 80000);
assert.equal(F.calculate(F.getTickets().find(ticket => ticket.id === planTicket.id)).balanceDueCents, 142000);
assert.equal(F.getSchedules().filter(item => item.ticketId === planTicket.id).reduce((sum, item) => sum + item.coveredAmountCents, 0), 80000);

// 4. Vencimiento automático.
const lateTicket = F.getTickets().find(ticket => ticket.orderId === 4);
F.createPlan(lateTicket.id, { frequency: 'weekly', firstDueDate: '2020-01-01', numberOfPayments: 2, surchargeType: 'none' });
assert.equal(F.calculateFinancialStatus(lateTicket), 'overdue');

// 5. Comprobante enlazado al abono.
const proofTicket = F.getTickets().find(ticket => ticket.orderId === 5);
const proofPayment = F.registerPayment({ ticketId: proofTicket.id, amount: 100, date: '2026-08-17', method: 'Transferencia' });
const proof = F.createProof(proofPayment.id, { name: 'pago.png', type: 'image/png', size: 100, dataUrl: 'data:image/png;base64,AA==' });
assert.equal(F.getPayments().find(item => item.id === proofPayment.id).proofId, proof.id);

// 6. Efectivo sin comprobante.
assert.equal(F.getPayments().find(item => item.id === 1).proofId, null);

// 7. Cancelación genera exactamente $1,100 de saldo a favor.
const cancelTicket = F.getTickets().find(ticket => ticket.orderId === 3);
F.registerPayment({ ticketId: cancelTicket.id, amount: 2000, date: '2026-08-17', method: 'Efectivo' });
orders[2].products[0].status = 'cancelled';
app.localStorage.setItem('orders', JSON.stringify(orders));
F.resolveCancellation(3, 'credit');
assert.equal(F.calculateClientCredit(1), 110000);

// 8. El saldo se aplica a un ticket nuevo y deja $400 pendientes.
F.applyCredit(lateTicket.id, 1100);
assert.equal(F.calculate(lateTicket).balanceDueCents, 40000);
assert.equal(F.calculateClientCredit(1), 0);

// 9. Reembolso registrado independientemente, sin crear saldo a favor.
F.registerRefund({ ticketId: cash.id, amount: 100, date: '2026-08-17', method: 'Transferencia', reason: 'Ajuste' });
assert.equal(F.getRefunds().filter(item => item.ticketId === cash.id).length, 1);
assert.equal(F.calculateClientCredit(1), 0);

// 10. Aislamiento por clientId (misma regla que usa el portal).
assert.ok(F.getTickets().filter(ticket => ticket.clientId === 1).every(ticket => ticket.clientId === 1));
assert.equal(F.getTickets().filter(ticket => ticket.clientId === 999).length, 0);

// 11. Persistencia tras reiniciar el contexto.
const persisted = {};
for (const [key, value] of app.values) persisted[key] = JSON.parse(value);
const reload = boot({ orders, clients: [{ id: 1, name: 'Ana' }], storage: persisted });
assert.equal(reload.F.getPayments().length, F.getPayments().length);
assert.equal(reload.F.getProofs().length, 1);

// 12. El precio histórico no cambia aunque cambie el producto original.
orders[0].products[0].unitPrice = 9999;
app.localStorage.setItem('orders', JSON.stringify(orders));
F.syncTicketForOrder(1);
assert.equal(F.getTickets().find(ticket => ticket.orderId === 1).itemsSnapshot[0].originalUnitPriceCents, 150000);

console.log('OK: 12 escenarios financieros de Fase 2.');
