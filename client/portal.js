(function() {
  'use strict';
  const financeStyles=document.createElement('link');financeStyles.rel='stylesheet';financeStyles.href=new URL('finance-client.css',document.currentScript.src).href;document.head.appendChild(financeStyles);
  const data = window.GlamData;
  const statusLabels = {
    pending_order: 'Pedido recibido', ordered: 'Ordenado', in_transit: 'En camino',
    received: 'Disponible para entrega', delivered: 'Entregado', cancelled: 'Cancelado'
  };

  function money(value) {
    return Number(value || 0).toLocaleString('es-MX', {style: 'currency', currency: 'MXN'});
  }

  function selectedClient() {
    return data.getClient(data.getPortalClientId());
  }

  function showClientSelector() {
    const shell = document.getElementById('portal-content');
    const clients = data.getClients();
    document.body.classList.add('has-local-access');
    const formStyles = document.createElement('link');
    formStyles.rel = 'stylesheet';
    formStyles.href = new URL('form-pilot.css', financeStyles.href).href;
    document.head.appendChild(formStyles);
    shell.innerHTML = `<section class="local-access"><div class="access-brand-panel"><span class="access-brand">luxury finds</span><p>Tu selección, tus pedidos y tus entregas en un solo lugar.</p></div><div class="access-form-panel"><div class="form-heading"><span class="form-step">Paso 01 · Acceso local</span><h1>Elige tu perfil.</h1><p>Selecciona una clienta para previsualizar su portal. Este acceso es únicamente para desarrollo y no sustituye autenticación real.</p></div><div class="form-group"><label for="client-preview-search">Buscar clienta</label><div class="input-with-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><input id="client-preview-search" type="search" placeholder="Nombre, teléfono o Instagram" autocomplete="off"></div></div><div class="form-group"><span class="field-label">Perfiles disponibles</span><div class="client-preview-list" id="client-preview-list">${clientPreviewButtons(clients)}</div><p class="client-preview-empty" id="client-preview-empty" hidden>No encontramos una clienta con esa búsqueda.</p></div></div></section>`;
    document.getElementById('client-preview-search').addEventListener('input', event => filterClientPreview(event.target.value));
  }

  function clientPreviewButtons(clients) {
    return clients.map(client => `<button class="client-chip" type="button" data-search="${`${client.name} ${client.whatsapp || ''} ${client.phone || ''} ${client.instagram || ''}`.toLowerCase()}" onclick="selectPortalClient(${client.id})"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg><span><strong>${client.name}</strong><small>${client.whatsapp || client.phone || (client.instagram ? '@' + client.instagram : '')}</small></span></button>`).join('') || '<p>No hay clientes registrados.</p>';
  }

  function filterClientPreview(value) {
    const query = value.trim().toLowerCase();
    const buttons = [...document.querySelectorAll('.client-chip')];
    buttons.forEach(button => button.hidden = !button.dataset.search.includes(query));
    document.getElementById('client-preview-empty').hidden = buttons.some(button => !button.hidden);
  }

  window.selectPortalClient = function(id) {
    data.setPortalClientId(id);
    location.reload();
  };

  window.changePortalClient = function() {
    data.clearPortalClientId();
    location.reload();
  };

  function productCard(order, item) {
    const ticket=LuxuryFinance.getTickets().find(t=>t.orderId===order.id);
    const credit=ticket&&LuxuryFinance.getCredits().find(m=>m.sourceTicketId===ticket.id&&m.type==='credit_created');
    const refund=ticket&&LuxuryFinance.getRefunds().find(r=>r.ticketId===ticket.id&&(r.orderItemId==null||String(r.orderItemId)===String(item.id)));
    const resolution=item.status==='cancelled'?(credit?`<small>Resolución: ${LuxuryFinance.formatMoney(credit.amountCents)} en saldo a favor</small>`:refund?`<small>Resolución: reembolso de ${LuxuryFinance.formatMoney(refund.amountCents)}</small>`:''):'';
    return `<article class="purchase-item ${item.status === 'cancelled' ? 'is-cancelled' : ''}">
      <div class="item-icon">${item.emoji || '📦'}</div><div><strong>${item.name}</strong>
      <span>${statusLabels[item.status] || 'En proceso'}</span>${item.status === 'cancelled' ? `<small>${item.cancellationReason || 'No fue posible conseguir este producto.'}</small>${resolution}` : (item.clientNotes ? `<small>${item.clientNotes}</small>` : '')}</div>
      <b>${money(item.subtotal || item.unitPrice)}</b></article>`;
  }

  function renderHome(client, orders) {
    const activeItems = orders.flatMap(order => order.products.map(item => ({order, item}))).filter(row => !['delivered', 'cancelled'].includes(row.item.status));
    const nextDelivery = orders.filter(order => order.entrega).sort((a,b) => a.entrega.fecha.localeCompare(b.entrega.fecha))[0];
    const nextPayment = LuxuryFinance.getNextScheduledPayment(client.id);
    return `<div class="hello"><span>Hola,</span><h1>${client.name.split(' ')[0]} 👋</h1><p>Aquí puedes consultar tus pedidos, pagos y entregas.</p></div>
      <section class="portal-card payment-highlight"><span class="eyebrow">Próximo pago</span>${nextPayment?`<h2>${LuxuryFinance.formatMoney(nextPayment.expectedAmountCents-nextPayment.coveredAmountCents)}</h2><p>${LuxuryFinance.formatDate(nextPayment.dueDate)}</p><a class="portal-button" href="pagos.html">Ver plan de pagos</a>`:'<h2>No tienes pagos próximos</h2>'}</section>
      <section><div class="section-title"><h2>Mis pedidos</h2><a href="compras.html">Ver todos</a></div><div class="portal-list">${activeItems.slice(0,4).map(({order,item}) => productCard(order,item)).join('') || '<div class="empty-portal">No tienes pedidos activos.</div>'}</div></section>
      <section class="portal-card"><span class="eyebrow">Próxima entrega</span>${nextDelivery ? `<h2>${new Date(nextDelivery.entrega.fecha + 'T00:00:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'})}</h2><p>${nextDelivery.entrega.hora} · ${nextDelivery.entrega.location === 'indeco' ? 'Indeco de 8' : 'Villas del Encanto'}</p><a class="portal-button" href="entregas.html">Ver detalles</a>` : '<p>No tienes entregas programadas.</p>'}</section>`;
  }

  function renderPurchases(client, orders) {
    const tickets=LuxuryFinance.getTickets().filter(ticket=>ticket.clientId===client.id);
    return `<div class="portal-heading"><h1>Mis compras</h1><p>Tickets y seguimiento de tus productos</p></div>${tickets.length?tickets.map(ticket=>{
      const order=orders.find(o=>o.id===ticket.orderId)||{id:ticket.orderId,products:[]};
      const c=LuxuryFinance.calculate(ticket);
      const plan=LuxuryFinance.getPlans().find(p=>p.id===ticket.paymentPlanId);
      return `<section class="portal-card ticket-card"><div class="ticket-head"><div><span class="eyebrow">Ticket</span><h2>${ticket.folio}</h2></div><strong>${LuxuryFinance.formatMoney(c.totalCents)}</strong></div><div class="ticket-client-summary"><span>Pagado <b>${LuxuryFinance.formatMoney(c.amountPaidCents+c.creditAppliedCents)}</b></span><span>Pendiente <b>${LuxuryFinance.formatMoney(c.balanceDueCents)}</b></span>${plan?`<span>Plan <b>${plan.frequency==='weekly'?'Semanal':plan.frequency==='biweekly'?'Quincenal':'Personalizado'}</b></span>`:''}</div><div class="portal-list">${order.products.map(item=>productCard(order,item)).join('')}</div></section>`;
    }).join(''):'<div class="empty-portal">Aún no tienes compras registradas.</div>'}`;
  }

  function renderCatalog() {
    const products = data.getProducts().filter(product => Number(product.stock) > 0);
    return `<div class="portal-heading"><h1>Catálogo</h1><p>Productos disponibles para entrega inmediata</p></div><div class="client-catalog">${products.map(product => `<article class="catalog-client-card"><div>${product.emoji || '✨'}</div><span>${product.category || 'Producto'}</span><h2>${product.name}</h2><strong>${money(product.price)}</strong><small>Disponible</small></article>`).join('') || '<div class="empty-portal">No hay productos disponibles.</div>'}</div>`;
  }

  function renderDeliveries(client, orders) {
    const deliveries = orders.filter(order => order.entrega);
    return `<div class="portal-heading"><h1>Mis entregas</h1><p>Fechas y lugares programados</p></div>${deliveries.map(order => `<section class="portal-card delivery-card"><span class="eyebrow">Pedido #${order.id}</span><h2>${new Date(order.entrega.fecha + 'T00:00:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</h2><p>${order.entrega.hora}</p><p>${order.entrega.location === 'indeco' ? 'Indeco de 8' : 'Villas del Encanto'}</p><ul>${order.products.filter(item => item.status !== 'cancelled').map(item => `<li>${item.name}</li>`).join('')}</ul></section>`).join('') || '<div class="empty-portal">No tienes entregas programadas.</div>'}`;
  }

  function renderPayments(client) {
    const tickets=LuxuryFinance.getTickets().filter(t=>t.clientId===client.id),payments=LuxuryFinance.getPayments().filter(p=>p.clientId===client.id).sort((a,b)=>b.date.localeCompare(a.date));
    const totals=tickets.reduce((a,t)=>{const c=LuxuryFinance.calculate(t);a.total+=c.totalCents;a.paid+=c.amountPaidCents+c.creditAppliedCents;a.balance+=c.balanceDueCents;return a},{total:0,paid:0,balance:0});const credit=LuxuryFinance.calculateClientCredit(client.id),next=LuxuryFinance.getNextScheduledPayment(client.id);
    return `<div class="portal-heading"><h1>Mis pagos</h1><p>Consulta tus planes y abonos registrados</p></div><div class="portal-money-grid"><div><span>Total comprado</span><strong>${LuxuryFinance.formatMoney(totals.total)}</strong></div><div><span>Pagado</span><strong>${LuxuryFinance.formatMoney(totals.paid)}</strong></div><div><span>Pendiente</span><strong>${LuxuryFinance.formatMoney(totals.balance)}</strong></div><div><span>Saldo a favor</span><strong>${LuxuryFinance.formatMoney(credit)}</strong></div></div><section class="portal-card payment-highlight"><span class="eyebrow">Próximo pago</span>${next?`<h2>${LuxuryFinance.formatMoney(next.expectedAmountCents-next.coveredAmountCents)}</h2><p>${LuxuryFinance.formatDate(next.dueDate)}${next.status==='overdue'?' · Vencido':''}</p>`:'<h2>No tienes pagos próximos</h2>'}</section>${tickets.filter(t=>t.paymentPlanId).map(t=>{const schedules=LuxuryFinance.getSchedules().filter(s=>s.ticketId===t.id);return`<section class="portal-card"><span class="eyebrow">${t.folio}</span><h2>Calendario</h2><div class="client-schedule">${schedules.map(s=>`<div class="${s.status}"><span>${LuxuryFinance.formatDate(s.dueDate)}</span><b>${LuxuryFinance.formatMoney(s.expectedAmountCents)}</b><small>${s.status==='paid'?'Pagado':s.status==='overdue'?'Vencido':s.status==='partial'?'Parcial':'Pendiente'}</small></div>`).join('')}</div></section>`}).join('')}<section class="portal-card"><h2>Historial de abonos</h2><div class="client-payment-history">${payments.map(p=>`<div><span>${LuxuryFinance.formatDate(p.date)}<small>${p.method}</small></span><b>${LuxuryFinance.formatMoney(p.amountCents)}</b></div>`).join('')||'<p>No hay abonos registrados.</p>'}</div></section>`;
  }

  function renderProfile(client) {
    return `<div class="portal-heading"><h1>Mi perfil</h1><p>Información registrada en GlamStudio</p></div><section class="portal-card profile-card"><div><span>Nombre</span><strong>${client.name}</strong></div><div><span>Celular</span><strong>${client.phone || 'No registrado'}</strong></div><div><span>WhatsApp</span><strong>${client.whatsapp || 'No registrado'}</strong></div><div><span>Instagram</span><strong>${client.instagram ? '@' + client.instagram : 'No registrado'}</strong></div><div><span>Email</span><strong>${client.email || 'No registrado'}</strong></div><p>Para solicitar un cambio en tus datos, contacta a GlamStudio.</p></section>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const client = selectedClient();
    if(!client) { showClientSelector(); return; }
    const orders = data.getClientOrders(client.id);
    document.getElementById('portal-client-name').textContent = client.name;
    document.getElementById('preview-warning').hidden = false;
    const page = document.body.dataset.clientPage;
    const renderers = {home: renderHome, purchases: renderPurchases, payments: renderPayments, catalog: renderCatalog, deliveries: renderDeliveries, profile: renderProfile};
    document.getElementById('portal-content').innerHTML = renderers[page](client, orders);
  });
})();
