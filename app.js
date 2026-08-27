// ==================== STORAGE ====================
const storage = window.GlamData?.storage || {
  get(key, defaultVal = []) {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : defaultVal;
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
};

// ==================== STATE & SCHEMA ====================
const SCHEMA_VERSION = 6;
const nowISO = () => new Date().toISOString();

const defaultOrders = [
  {
    id: 1,
    name: "Karen López",
    phone: "52 81 1234 5678",
    source: "WhatsApp",
    col: "entrega",
    notes: "Tono cálido",
    products: [
      {id: 1, name: "Foundation MAC NC25", emoji: "💄", status: "ok"},
      {id: 2, name: "Lipstick Ruby Woo", emoji: "💋", status: "ok"}
    ],
    entrega: {
      location: "indeco",
      fecha: "2026-07-14",
      hora: "10:00 am",
      notes: "Tocar timbre"
    }
  },
  {
    id: 2,
    name: "Sofía Martínez",
    phone: "52 81 8765 4321",
    source: "Instagram",
    col: "ordenado",
    notes: "",
    products: [
      {id: 3, name: "Perfume Chanel", emoji: "🌸", status: "wait"}
    ]
  },
  {
    id: 3,
    name: "Ana García",
    phone: "52 81 5555 1234",
    source: "WhatsApp",
    col: "nuevo",
    notes: "Urgente",
    products: [
      {id: 5, name: "Serum Vitamina C", emoji: "✨", status: "ok"}
    ]
  }
];

const defaultCatalog = [
  {id: 1, name: "Foundation MAC NC25", price: 850, emoji: "💄", category: "Base", stock: 1},
  {id: 2, name: "Lipstick Ruby Woo", price: 520, emoji: "💋", category: "Labial", stock: 1},
  {id: 3, name: "Perfume Chanel", price: 2800, emoji: "🌸", category: "Fragancia", stock: 0},
  {id: 4, name: "Mascara Lash Princess", price: 320, emoji: "👁️", category: "Ojos", stock: 1},
  {id: 5, name: "Serum Vitamina C", price: 680, emoji: "✨", category: "Cuidado", stock: 1},
  {id: 6, name: "Blush NARS Orgasm", price: 750, emoji: "🎀", category: "Mejillas", stock: 1},
  {id: 7, name: "Primer The Ordinary", price: 280, emoji: "💧", category: "Base", stock: 1},
  {id: 8, name: "Setting Spray Urban", price: 420, emoji: "💦", category: "Fijador", stock: 1}
];

function normalizePhone(value = '') {
  return value.replace(/\D/g, '');
}

function normalizeInstagram(value = '') {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function migrateData() {
  const hadCatalogData = localStorage.getItem('catalog') !== null;
  const hadOrderData = localStorage.getItem('orders') !== null;
  const catalogData = window.GlamData ? window.GlamData.getProducts() : storage.get('catalog', defaultCatalog);
  const orderData = storage.get('orders', defaultOrders);
  let clientData = storage.get('clients', []);
  const currentVersion = Number(localStorage.getItem('glamstudio_schema_version') || 0);
  if(currentVersion >= SCHEMA_VERSION && clientData.length) {
    return {catalogData, clientData, orderData};
  }
  if(!hadCatalogData) catalogData.forEach(product => product.isDemo = true);
  if(!hadOrderData) orderData.forEach(order => order.isDemo = true);

  orderData.forEach(order => {
    let client = clientData.find(c => c.id === order.clientId);
    const oldPhone = order.phone || '';
    const oldInstagram = order.source === 'Instagram' ? (order.instagram || '') : '';

    if(!client) {
      const phoneKey = normalizePhone(oldPhone);
      const instagramKey = normalizeInstagram(oldInstagram);
      client = clientData.find(c =>
        (phoneKey && normalizePhone(c.phone || c.whatsapp) === phoneKey) ||
        (instagramKey && normalizeInstagram(c.instagram) === instagramKey)
      );
    }

    if(!client) {
      const stamp = nowISO();
      client = {
        id: clientData.length ? Math.max(...clientData.map(c => Number(c.id) || 0)) + 1 : 1,
        name: order.name || 'Clienta sin nombre',
        phone: oldPhone,
        whatsapp: oldPhone,
        instagram: oldInstagram,
        email: '',
        notes: '',
        createdAt: stamp,
        updatedAt: stamp
      };
      clientData.push(client);
    }
    client.email = client.email || '';
    client.addresses = Array.isArray(client.addresses) ? client.addresses : [];
    client.tags = Array.isArray(client.tags) ? client.tags : [];

    order.clientId = client.id;
    order.createdAt = order.createdAt || nowISO();
    order.updatedAt = order.updatedAt || order.createdAt;
    order.products = (order.products || []).map((item, index) => {
      const catalogProduct = catalogData.find(p => p.id === (item.catalogProductId || item.id));
      const legacyStatus = {
        wait: 'pending_order', ok: 'received', cancel: 'cancelled'
      }[item.status] || (item.status === 'in_transit' ? 'ordered' : item.status) || 'pending_order';
      const quantity = Number(item.quantity) || 1;
      const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : Number(catalogProduct?.price || 0);
      return {
        ...item,
        id: item.id || `${order.id}-${index + 1}`,
        catalogProductId: item.catalogProductId || item.id,
        name: item.name || catalogProduct?.name || 'Producto',
        emoji: item.emoji || catalogProduct?.emoji || '📦',
        quantity,
        unitPrice,
        subtotal: quantity * unitPrice,
        status: legacyStatus,
        orderedAt: item.orderedAt || null,
        inTransitAt: item.inTransitAt || null,
        receivedAt: item.receivedAt || (legacyStatus === 'received' ? order.createdAt : null),
        deliveredAt: item.deliveredAt || (legacyStatus === 'delivered' ? order.updatedAt : null),
        cancelledAt: item.cancelledAt || (legacyStatus === 'cancelled' ? order.updatedAt : null),
        cancellationReason: item.cancellationReason || '',
        variant: item.variant || {},
        isSpecialProduct: Boolean(item.isSpecialProduct),
        image: item.image || '',
        productLink: item.productLink || '',
        brand: item.brand || '',
        expectedStore: item.expectedStore || item.expectedProvider || '',
        estimatedCost: item.estimatedCost ?? null,
        maxPurchaseBudget: item.maxPurchaseBudget ?? null,
        internalNotes: item.internalNotes || '',
        clientNotes: item.clientNotes || '',
        inboundTracking: item.inboundTracking || null,
        outboundTracking: item.outboundTracking || null
      };
    });
  });

  catalogData.forEach(product => {
    product.priceHistory = Array.isArray(product.priceHistory) && product.priceHistory.length
      ? product.priceHistory
      : [{price: Number(product.price || 0), effectiveAt: nowISO(), source: 'schema_migration'}];
    product.variants = Array.isArray(product.variants) ? product.variants : [];
  });

  storage.set('catalog', catalogData);
  storage.set('clients', clientData);
  storage.set('orders', orderData);
  if(window.LuxuryFinance) orderData.forEach(order => window.LuxuryFinance.createTicketFromOrder(order));
  localStorage.setItem('glamstudio_schema_version', String(SCHEMA_VERSION));
  return {catalogData, clientData, orderData};
}

const migrated = migrateData();
let orders = migrated.orderData;
let catalog = migrated.catalogData;
let clients = migrated.clientData;

let currentEditId = null;
let selectedLocation = null;
let selectedSlot = null;
let schedOrderId = null;
let cancelOrderId = null;
let selectedClientId = null;

function getClient(clientId) {
  return clients.find(c => c.id === clientId) || {name: 'Clienta sin registro', phone: '', whatsapp: '', instagram: ''};
}

function getOrderProgress(order) {
  const active = order.products.filter(p => p.status !== 'cancelled');
  if(!active.length) return {label: 'Cancelado', col: 'nuevo'};
  if(active.every(p => p.status === 'delivered')) return {label: 'Entregado', col: 'entregado'};
  if(active.some(p => p.status === 'received' || p.status === 'delivered')) return {label: 'Parcialmente disponible', col: 'entrega'};
  if(active.every(p => p.status === 'ordered')) return {label: 'Ordenado / En camino', col: 'ordenado'};
  if(active.some(p => p.status === 'ordered')) return {label: 'Parcialmente ordenado', col: 'ordenado'};
  return {label: 'Sin ordenar', col: 'nuevo'};
}

function getActiveTotal(order) {
  return order.products.reduce((sum, p) => p.status === 'cancelled' ? sum : sum + Number(p.subtotal || (p.quantity || 1) * (p.unitPrice || 0)), 0);
}

function saveAll() {
  storage.set('orders', orders);
  storage.set('clients', clients);
  if(window.LuxuryFinance) {
    if(currentEditId) window.LuxuryFinance.syncTicketForOrder(currentEditId);
    else window.LuxuryFinance.createTicketFromOrder(orders[orders.length - 1]);
  }
}

function recordActivity({action, entityType, entityId, clientId = null, details = {}}) {
  const activity = storage.get('activityLog', []);
  activity.push({
    id: activity.length ? Math.max(...activity.map(event => Number(event.id) || 0)) + 1 : 1,
    occurredAt: nowISO(), action, entityType, entityId, clientId, details
  });
  storage.set('activityLog', activity);
}

// ==================== RENDER ====================
function render() {
  renderKanban();
  renderCatalog();
  renderAgenda();
  renderPendingProducts();
  renderOperationalLists();
  renderClients();
  updateStats();
}

function updateStats() {
  const counts = {pending_order: 0, ordered: 0, received: 0, delivered: 0};
  orders.flatMap(o => o.products).forEach(p => {
    if(counts[p.status] != null) counts[p.status]++;
  });
  
  if(document.getElementById('s0')) document.getElementById('s0').textContent = counts.pending_order;
  if(document.getElementById('s1')) document.getElementById('s1').textContent = counts.ordered;
  if(document.getElementById('s2')) document.getElementById('s2').textContent = counts.received;
  if(document.getElementById('s3')) document.getElementById('s3').textContent = counts.delivered;
}

function renderKanban() {
  const container = document.getElementById('kanban');
  if(!container) return;

  const columns = [
    {key: 'nuevo', title: 'Sin ordenar', badge: 'b-co', accent: 'acc-co'},
    {key: 'ordenado', title: 'Ordenados', badge: 'b-am', accent: 'acc-am'},
    {key: 'entrega', title: 'Pend. entrega', badge: 'b-pu', accent: 'acc-pu'},
    {key: 'entregado', title: 'Entregados', badge: 'b-gr', accent: 'acc-gr'}
  ];

  container.innerHTML = columns.map(col => {
    const colOrders = orders.filter(o => getOrderProgress(o).col === col.key);
    return `
      <div>
        <div class="col-hd">
          <div class="col-title">${col.title}</div>
          <div class="cbadge ${col.badge}">${colOrders.length}</div>
        </div>
        ${colOrders.map(o => renderCard(o, col.accent)).join('')}
      </div>
    `;
  }).join('');
}

function renderProductProgress(orderId, product) {
  if(product.status === 'cancelled') {
    return `<div class="product-progress cancelled-detail">${product.cancellationReason || 'Producto cancelado'}</div>`;
  }
  const rank = {pending_order: 0, ordered: 1, received: 2, delivered: 3}[product.status] || 0;
  const steps = [
    ['Ordenado', 'ordered'], ['Llegó', 'received'], ['Entregado', 'delivered']
  ];
  return `<div class="product-progress">${steps.map((step, index) => `
    <button class="progress-step ${rank >= index + 1 ? 'done' : ''}"
      onclick="advanceProduct(${orderId}, '${product.id}', '${step[1]}')"
      ${rank !== index || rank >= 3 ? 'disabled' : ''}>${rank >= index + 1 ? '✓' : '○'} ${step[0]}</button>
  `).join('')}</div>`;
}

function renderCard(o, accent) {
  const client = getClient(o.clientId);
  const srcBadge = o.source === 'Instagram' ? '<span class="src-ig">IG</span>' : '<span class="src-wa">WA</span>';
  let entregaChip = '';
  if(o.entrega) {
    const loc = o.entrega.location === 'indeco' ? 'Indeco' : 'Villas';
    const dotClass = o.entrega.location === 'indeco' ? 'dot-indeco' : 'dot-villas';
    entregaChip = `<div class="entrega-chip confirmada"><div class="dot-loc ${dotClass}"></div>${loc} - ${o.entrega.fecha} ${o.entrega.hora}</div>`;
  }
  const labels = {
    pending_order: ['ps-wait', 'Pendiente por ordenar'], ordered: ['ps-wait', 'Ordenado / En camino'],
    received: ['ps-ok', 'Llegó / Disponible'], delivered: ['ps-ok', 'Entregado'], cancelled: ['ps-cancel', 'Cancelado']
  };
  const prodList = o.products.map(p => {
    const meta = labels[p.status] || ['ps-wait', p.status];
    return `<div class="order-product-item">
      <div class="prod-row"><div class="prod-img">${p.emoji || '📦'}</div>
      <div class="prod-name">${p.name}<small>${p.quantity || 1} × $${Number(p.unitPrice || 0).toLocaleString()}</small></div>
      <div class="prod-status ${meta[0]}">${meta[1]}</div></div>
      ${renderProductProgress(o.id, p)}
    </div>`;
  }).join('');
  const progress = getOrderProgress(o);
  const actions = `<button class="btn-sm btn-wa" onclick="sendWhatsApp(${o.id})">Enviar WA</button>
    <button class="btn-sm btn-edit" onclick="editOrder(${o.id})">Editar</button>
    <button class="btn-sm btn-cancel-prod" onclick="openCancelProds(${o.id})">Cancelar prod.</button>
    <button class="btn-sm btn-sched" onclick="openSched(${o.id}, ${!!o.entrega})">${o.entrega ? 'Reagendar' : 'Agendar entrega'}</button>`;
  return `<div class="card ${accent}"><div class="card-top"><div>
    <div class="cname">${client.name}</div><div class="cdate">${client.whatsapp || client.phone || (client.instagram ? '@' + client.instagram : '')}</div>
    </div>${srcBadge}</div>${entregaChip}<div class="prod-list">${prodList}</div>
    <div class="order-progress-label">${progress.label}</div>
    <div class="cprice">Total activo: $${getActiveTotal(o).toLocaleString()}</div>
    <div class="card-actions">${actions}</div></div>`;
}

function advanceProduct(orderId, productId, targetStatus) {
  const order = orders.find(o => o.id === orderId);
  const product = order?.products.find(p => String(p.id) === String(productId));
  if(!product || product.status === 'cancelled') return;
  const allowed = {pending_order: 'ordered', ordered: 'received', received: 'delivered'};
  if(allowed[product.status] !== targetStatus) {
    showToast('Completa primero el paso anterior');
    return;
  }
  product.status = targetStatus;
  const timestampField = {ordered: 'orderedAt', received: 'receivedAt', delivered: 'deliveredAt'}[targetStatus];
  product[timestampField] = nowISO();
  order.updatedAt = nowISO();
  order.col = getOrderProgress(order).col;
  storage.set('orders', orders);
  recordActivity({action: `product_${targetStatus}`, entityType: 'orderItem', entityId: product.id, clientId: order.clientId, details: {orderId: order.id, productName: product.name}});
  render();
  if(typeof renderAvailable === 'function') renderAvailable();
  const statusText = {ordered: 'Ordenado / En camino', received: 'Llegó', delivered: 'Entregado'};
  showToast(`Producto actualizado: ${statusText[targetStatus]}`);
}

function renderPendingProducts() {
  const container = document.getElementById('pending-products');
  if(!container) return;
  const pending = orders.flatMap(order => order.products
    .filter(product => product.status === 'pending_order')
    .map(product => ({order, product, client: getClient(order.clientId)})));
  container.innerHTML = pending.length ? pending.map(({order, product, client}) => `
    <div class="pending-item"><button class="pending-check" title="Marcar como ordenado" onclick="advanceProduct(${order.id}, '${product.id}', 'ordered')">○</button>
      <div><strong>${product.name}</strong><span>${client.name} · Pedido #${order.id}</span>
      <span>$${Number(product.unitPrice || 0).toLocaleString()}${order.createdAt ? ` · ${new Date(order.createdAt).toLocaleDateString('es-MX')}` : ''}</span></div>
    </div>`).join('') : '<div class="empty-compact">No hay productos pendientes por ordenar.</div>';
}

function renderOperationalLists() {
  const pendingContainer = document.getElementById('all-pending-products');
  const transitContainer = document.getElementById('in-transit-products');
  const rows = orders.flatMap(order => order.products.map(product => ({order, product, client: getClient(order.clientId)})));
  if(pendingContainer) {
    const pending = rows.filter(row => row.product.status === 'pending_order');
    pendingContainer.innerHTML = pending.length ? pending.map(({order, product, client}) => `
      <article class="operation-card"><div class="operation-image">${product.emoji || '📦'}</div><div class="operation-main">
      <h3>${product.name}</h3><p>${client.name} · Pedido #${order.id}</p>
      <div class="operation-meta"><span>Cantidad: ${product.quantity || 1}</span><span>$${Number(product.unitPrice || 0).toLocaleString()}</span><span>${order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-MX') : ''}</span><span>${product.expectedProvider || 'Proveedor sin definir'}</span></div></div>
      <button class="btn-primary" onclick="advanceProduct(${order.id}, '${product.id}', 'ordered')">Ya lo ordené</button></article>`).join('') : '<div class="empty-compact">No hay productos pendientes por ordenar.</div>';
  }
  if(transitContainer) {
    const transit = rows.filter(row => row.product.status === 'ordered');
    transitContainer.innerHTML = transit.length ? transit.map(({order, product, client}) => `
      <article class="operation-card"><div class="operation-image">${product.emoji || '📦'}</div><div class="operation-main">
      <h3>${product.name}</h3><p>${client.name} · Pedido #${order.id}</p>
      <div class="operation-meta"><span>Ordenado: ${product.orderedAt ? new Date(product.orderedAt).toLocaleDateString('es-MX') : 'Sin fecha'}</span><span>${product.expectedProvider || 'Proveedor sin definir'}</span><span>${product.orderNumber ? 'Orden: ' + product.orderNumber : 'Sin número de orden'}</span><span>${product.tracking ? 'Tracking: ' + product.tracking : 'Sin tracking'}</span></div></div>
      <button class="btn-primary" onclick="advanceProduct(${order.id}, '${product.id}', 'received')">Marcar como llegó</button></article>`).join('') : '<div class="empty-compact">No hay productos ordenados o en camino.</div>';
  }
}

function renderAgenda() {
  const container = document.getElementById("agenda");
  if(!container) return;

  const entregas = orders.filter(o => o.entrega && getOrderProgress(o).col !== 'entregado');

  if(entregas.length === 0){
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:var(--color-text-secondary)">
        <div style="font-size:48px;margin-bottom:1rem">📅</div>
        <div style="font-size:14px">No hay entregas agendadas</div>
      </div>
    `;
    return;
  }

  const porFecha = {};
  entregas.forEach(o=>{
    const f = o.entrega.fecha;
    if(!porFecha[f]) porFecha[f] = [];
    porFecha[f].push(o);
  });

  container.innerHTML = Object.keys(porFecha).sort().map(fecha => {
    const fechaObj = new Date(fecha + 'T00:00:00');
    const dateStr = fechaObj.toLocaleDateString('es-MX', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    return `
      <div style="margin-bottom:1.5rem">
        <div style="font-size:13px;font-weight:500;margin-bottom:10px;color:var(--color-text-primary);text-transform:capitalize">
          ${dateStr}
        </div>
        ${porFecha[fecha].map(o=>{
          const client = getClient(o.clientId);
          const loc = o.entrega.location === 'indeco' ? 'Indeco de 8' : 'Villas del Encanto';
          const dotClass = o.entrega.location === 'indeco' ? 'dot-indeco' : 'dot-villas';
          
          return `
            <div class="card acc-pu">
              <div class="card-top">
                <div>
                  <div class="cname">${client.name}</div>
                  <div class="cdate">${client.whatsapp || client.phone || ''}</div>
                </div>
              </div>
              
              <div class="entrega-chip confirmada">
                <div class="dot-loc ${dotClass}"></div>
                ${loc} - ${o.entrega.hora}
              </div>

              <div class="card-actions">
                <button class="btn-sm btn-reagendar" onclick="openSched(${o.id}, true)">
                  Reagendar
                </button>
                <button class="btn-sm btn-cancel-entrega" onclick="openCancelEntrega(${o.id})">
                  Cancelar entrega
                </button>
                <button class="btn-sm btn-wa" onclick="sendWhatsApp(${o.id}, 'recordatorio')">
                  Recordatorio WA
                </button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }).join("");
}

function renderCatalog() {
  const container = document.getElementById('cat-grid');
  if(!container) return;

  if(catalog.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--color-text-secondary)">
        <div style="font-size:48px;margin-bottom:1rem">📦</div>
        <div style="font-size:14px">No hay productos en el catálogo</div>
      </div>
    `;
    return;
  }

  container.innerHTML = catalog.map(p => `
    <div class="cat-card" onclick="editProduct(${p.id})">
      <div class="cat-img">${p.emoji}</div>
      <div class="cat-info">
        <div class="cat-pname">${p.name}</div>
        <div class="cat-price">$${p.price}</div>
        <div class="cat-stock">${p.category}</div>
        ${p.stock === 0 ? '<div class="cat-badge-oos">Agotado</div>' : ''}
      </div>
    </div>
  `).join('');
}

function filterCatalog(query) {
  const filtered = storage.get('catalog', []).filter(p => 
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.category.toLowerCase().includes(query.toLowerCase())
  );
  catalog = filtered;
  renderCatalog();
}

// ==================== ORDERS ====================
function enhanceOrderModal() {
  const nameInput = document.getElementById('f-name');
  if(!nameInput || document.getElementById('client-search')) return;
  const field = nameInput.closest('.field');
  field.insertAdjacentHTML('beforebegin', `
    <div class="field client-picker"><label>Buscar cliente existente</label>
      <input id="client-search" type="search" placeholder="Nombre, teléfono o Instagram" oninput="renderClientMatches(this.value)">
      <div id="client-matches" class="client-matches"></div>
      <div id="selected-client-chip" class="selected-client-chip" style="display:none"></div>
    </div>`);
  field.querySelector('label').textContent = 'Nombre de clienta nueva';
  const phoneField = document.getElementById('f-phone').closest('.field');
  phoneField.insertAdjacentHTML('afterend', `<div class="field"><label>Instagram (opcional)</label><input id="f-instagram" placeholder="@usuario"></div>`);
}

function renderClientMatches(query = '') {
  const container = document.getElementById('client-matches');
  if(!container) return;
  const q = query.trim().toLowerCase();
  if(!q) { container.innerHTML = ''; return; }
  const matches = clients.filter(c => [c.name, c.phone, c.whatsapp, c.instagram].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 6);
  container.innerHTML = matches.map(c => `<button type="button" onclick="selectOrderClient(${c.id})"><strong>${c.name}</strong><span>${c.whatsapp || c.phone || ''} ${c.instagram ? ' · @' + c.instagram : ''}</span></button>`).join('') || '<div class="empty-compact">Sin coincidencias. Captura una clienta nueva.</div>';
}

function selectOrderClient(id) {
  const client = getClient(id);
  selectedClientId = id;
  document.getElementById('f-name').value = client.name || '';
  document.getElementById('f-phone').value = client.whatsapp || client.phone || '';
  document.getElementById('f-instagram').value = client.instagram ? '@' + client.instagram : '';
  document.getElementById('client-matches').innerHTML = '';
  const chip = document.getElementById('selected-client-chip');
  chip.style.display = 'flex';
  chip.innerHTML = `<span>Cliente seleccionado: <strong>${client.name}</strong></span><button type="button" onclick="clearOrderClient()">Cambiar</button>`;
}

function clearOrderClient() {
  selectedClientId = null;
  ['f-name', 'f-phone', 'f-instagram', 'client-search'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  const chip = document.getElementById('selected-client-chip');
  if(chip) chip.style.display = 'none';
}

function openNewOrder() {
  currentEditId = null;
  clearOrderClient();
  document.getElementById('order-modal-title').textContent = 'Nuevo pedido';
  document.getElementById('f-name').value = '';
  document.getElementById('f-phone').value = '';
  document.getElementById('f-source').value = 'WhatsApp';
  document.getElementById('f-notes').value = '';
  renderProdSelector([]);
  document.getElementById('order-modal').style.display = 'flex';
}

function editOrder(id) {
  const order = orders.find(o => o.id === id);
  if(!order) return;
  const client = getClient(order.clientId);
  
  currentEditId = id;
  document.getElementById('order-modal-title').textContent = 'Editar pedido';
  selectOrderClient(client.id);
  document.getElementById('f-source').value = order.source;
  document.getElementById('f-notes').value = order.notes || '';
  renderProdSelector(order.products.map(p => p.catalogProductId));
  document.getElementById('order-modal').style.display = 'flex';
}

function renderProdSelector(selectedIds = []) {
  const container = document.getElementById('prod-selector');
  if(!container) return;

  const fullCatalog = storage.get('catalog', []);
  
  container.innerHTML = fullCatalog.map(p => `
    <div class="prod-opt ${selectedIds.includes(p.id) ? 'selected' : ''}" onclick="toggleProduct(${p.id})">
      <input type="checkbox" class="chk" ${selectedIds.includes(p.id) ? 'checked' : ''} onchange="event.stopPropagation(); toggleProduct(${p.id})"/>
      <div class="prod-opt-img">${p.emoji}</div>
      <div class="prod-opt-name">${p.name}</div>
      <div class="prod-opt-price">$${p.price}</div>
    </div>
  `).join('');
}

function toggleProduct(prodId) {
  const opt = document.querySelector(`#prod-selector .prod-opt:has(input[type="checkbox"]):has(.prod-opt-img)`);
  // Simple toggle visual
  const allOpts = document.querySelectorAll('#prod-selector .prod-opt');
  allOpts.forEach(o => {
    const checkbox = o.querySelector('.chk');
    const isThisOne = [...o.querySelectorAll('*')].some(el => 
      el.textContent.includes(catalog.find(c => c.id === prodId)?.name || '')
    );
    if(isThisOne) {
      checkbox.checked = !checkbox.checked;
      o.classList.toggle('selected', checkbox.checked);
    }
  });
}

function filterProdOpts(query) {
  const fullCatalog = storage.get('catalog', []);
  const filtered = fullCatalog.filter(p => 
    p.name.toLowerCase().includes(query.toLowerCase())
  );
  
  const selectedIds = [];
  document.querySelectorAll('#prod-selector .chk:checked').forEach(chk => {
    const parent = chk.closest('.prod-opt');
    const name = parent.querySelector('.prod-opt-name').textContent;
    const prod = fullCatalog.find(p => p.name === name);
    if(prod) selectedIds.push(prod.id);
  });
  
  const container = document.getElementById('prod-selector');
  container.innerHTML = filtered.map(p => `
    <div class="prod-opt ${selectedIds.includes(p.id) ? 'selected' : ''}" onclick="toggleProduct(${p.id})">
      <input type="checkbox" class="chk" ${selectedIds.includes(p.id) ? 'checked' : ''} onchange="event.stopPropagation(); toggleProduct(${p.id})"/>
      <div class="prod-opt-img">${p.emoji}</div>
      <div class="prod-opt-name">${p.name}</div>
      <div class="prod-opt-price">$${p.price}</div>
    </div>
  `).join('');
}

function saveOrder() {
  const name = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const instagram = normalizeInstagram(document.getElementById('f-instagram')?.value || '');
  const source = document.getElementById('f-source').value;
  const notes = document.getElementById('f-notes').value.trim();
  
  if(!name || (!phone && !instagram)) {
    showToast('Completa el nombre y al menos teléfono o Instagram');
    return;
  }
  
  let client = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;
  if(!client) {
    const phoneKey = normalizePhone(phone);
    client = clients.find(c => (phoneKey && normalizePhone(c.phone || c.whatsapp) === phoneKey) || (instagram && normalizeInstagram(c.instagram) === instagram));
  }
  if(client) {
    client.name = name || client.name;
    client.phone = phone || client.phone;
    client.whatsapp = phone || client.whatsapp;
    client.instagram = instagram || client.instagram;
    client.updatedAt = nowISO();
  } else {
    const stamp = nowISO();
    client = {id: clients.length ? Math.max(...clients.map(c => Number(c.id) || 0)) + 1 : 1, name, phone, whatsapp: phone, instagram, email: '', notes: '', addresses: [], tags: [], createdAt: stamp, updatedAt: stamp};
    clients.push(client);
  }

  const existingOrder = currentEditId ? orders.find(o => o.id === currentEditId) : null;
  const selectedProds = [];
  document.querySelectorAll('#prod-selector .chk:checked').forEach(chk => {
    const parent = chk.closest('.prod-opt');
    const prodName = parent.querySelector('.prod-opt-name').textContent;
    const prod = storage.get('catalog', []).find(p => p.name === prodName);
    if(prod) {
      const existing = existingOrder?.products.find(p => p.catalogProductId === prod.id);
      selectedProds.push(existing || {
        id: `${currentEditId || 'new'}-${prod.id}-${Date.now()}`,
        catalogProductId: prod.id, name: prod.name, emoji: prod.emoji,
        quantity: 1, unitPrice: Number(prod.price), subtotal: Number(prod.price), status: 'pending_order',
        orderedAt: null, inTransitAt: null, receivedAt: null, deliveredAt: null, cancelledAt: null, cancellationReason: '',
        expectedProvider: '', orderNumber: '', tracking: '', logisticsNotes: '', variant: {}, isSpecialProduct: false,
        image: '', productLink: '', brand: '', expectedStore: '', estimatedCost: null, maxPurchaseBudget: null,
        internalNotes: '', clientNotes: '', inboundTracking: null, outboundTracking: null
      });
    }
  });
  
  if(selectedProds.length === 0) {
    showToast('Selecciona al menos un producto');
    return;
  }
  
  if(currentEditId) {
    const order = existingOrder;
    if(order) {
      order.clientId = client.id;
      order.source = source;
      order.notes = notes;
      order.products = selectedProds;
      order.updatedAt = nowISO();
      order.col = getOrderProgress(order).col;
    }
    showToast('Pedido actualizado');
  } else {
    const newId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 1;
    orders.push({
      id: newId,
      clientId: client.id,
      source,
      col: 'nuevo',
      notes,
      products: selectedProds.map(p => ({...p, id: `${newId}-${p.catalogProductId}-${Date.now()}`})),
      createdAt: nowISO(),
      updatedAt: nowISO()
    });
    recordActivity({action: 'order_created', entityType: 'order', entityId: newId, clientId: client.id, details: {productCount: selectedProds.length}});
    showToast('Pedido creado');
  }
  
  storage.set('orders', orders);
  storage.set('clients', clients);
  closeModal('order-modal');
  render();
}

function moveOrder(id, newCol) {
  const order = orders.find(o => o.id === id);
  if(!order) return;
  
  order.col = newCol;
  storage.set('orders', orders);
  render();
  showToast('Pedido movido');
}

function sendWhatsApp(id, type = 'confirmacion') {
  const order = orders.find(o => o.id === id);
  if(!order) return;
  const client = getClient(order.clientId);
  
  let message = '';
  if(type === 'confirmacion') {
    message = `Hola ${client.name}! Tu pedido ha sido confirmado:\n\n`;
    order.products.forEach(p => {
      message += `- ${p.name}\n`;
    });
    message += `\n¡Pronto te avisaremos cuando esté listo! 💕`;
  } else if(type === 'recordatorio') {
    message = `Hola ${client.name}! Recordatorio de tu entrega:\n\n`;
    message += `📍 ${order.entrega.location === 'indeco' ? 'Indeco de 8' : 'Villas del Encanto'}\n`;
    message += `📅 ${order.entrega.fecha} - ${order.entrega.hora}\n\n`;
    message += `¡Te esperamos! 🌟`;
  }
  
  const phone = normalizePhone(client.whatsapp || client.phone);
  if(!phone) { showToast('Esta clienta no tiene WhatsApp registrado'); return; }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

// ==================== SCHEDULING ====================
function openSched(orderId, isReschedule) {
  schedOrderId = orderId;
  const order = orders.find(o => o.id === orderId);
  
  document.getElementById('sched-modal-title').textContent = 
    isReschedule ? 'Reagendar entrega' : 'Agendar entrega';
  
  if(isReschedule && order.entrega) {
    const aviso = document.getElementById('sched-aviso');
    aviso.style.display = 'block';
    aviso.textContent = `Entrega actual: ${order.entrega.fecha} a las ${order.entrega.hora}`;
    selectedLocation = order.entrega.location;
    selectLoc(selectedLocation);
  } else {
    document.getElementById('sched-aviso').style.display = 'none';
    selectedLocation = null;
  }
  
  document.getElementById('sched-date').value = '';
  document.getElementById('sched-notes').value = '';
  document.getElementById('slots-wrap').style.display = 'none';
  document.getElementById('sched-modal').style.display = 'flex';
}

function selectLoc(loc) {
  selectedLocation = loc;
  document.getElementById('loc-indeco').classList.remove('selected-indeco', 'selected-villas');
  document.getElementById('loc-villas').classList.remove('selected-indeco', 'selected-villas');
  
  if(loc === 'indeco') {
    document.getElementById('loc-indeco').classList.add('selected-indeco');
  } else {
    document.getElementById('loc-villas').classList.add('selected-villas');
  }
}

function updateSlots() {
  const date = document.getElementById('sched-date').value;
  if(!date || !selectedLocation) return;
  
  const dateObj = new Date(date + 'T00:00:00');
  const today = new Date();
  today.setHours(0,0,0,0);
  
  if(dateObj <= today) {
    showToast('Selecciona una fecha futura (mínimo mañana)');
    return;
  }
  
  const dayOfWeek = dateObj.getDay();
  if(dayOfWeek === 0) {
    showToast('Los domingos no hay entregas');
    return;
  }
  
  const slots = selectedLocation === 'indeco' 
    ? ['8:30 am', '9:00 am', '9:30 am', '10:00 am', '10:30 am', '11:00 am', '11:30 am', '12:00 pm', '12:30 pm']
    : ['4:00 pm', '4:30 pm', '5:00 pm', '5:30 pm', '6:00 pm', '6:30 pm', '7:00 pm', '7:30 pm', '8:00 pm'];
  
  const container = document.getElementById('time-slots');
  container.innerHTML = slots.map(s => 
    `<div class="slot" onclick="selectSlot('${s}')">${s}</div>`
  ).join('');
  
  document.getElementById('slots-wrap').style.display = 'block';
  selectedSlot = null;
}

function selectSlot(slot) {
  selectedSlot = slot;
  document.querySelectorAll('#time-slots .slot').forEach(s => {
    s.classList.toggle('active-slot', s.textContent === slot);
  });
}

function saveSchedule() {
  const date = document.getElementById('sched-date').value;
  const notes = document.getElementById('sched-notes').value.trim();
  
  if(!selectedLocation || !date || !selectedSlot) {
    showToast('Completa todos los campos requeridos');
    return;
  }
  
  const order = orders.find(o => o.id === schedOrderId);
  if(!order) return;
  
  order.entrega = {
    location: selectedLocation,
    fecha: date,
    hora: selectedSlot,
    notes
  };
  
  storage.set('orders', orders);
  closeModal('sched-modal');
  render();
  showToast('Entrega agendada - Agrégala a tu calendario');
}

function openCancelEntrega(orderId) {
  cancelOrderId = orderId;
  document.getElementById('cancel-reason').value = '';
  document.getElementById('cancel-entrega-modal').style.display = 'flex';
}

function confirmCancelEntrega() {
  const reason = document.getElementById('cancel-reason').value.trim();
  if(!reason) {
    showToast('Escribe un motivo de cancelación');
    return;
  }
  
  const order = orders.find(o => o.id === cancelOrderId);
  if(!order) return;
  const client = getClient(order.clientId);
  
  const message = `Hola ${client.name}, lamentablemente debo cancelar la entrega programada.\n\n${reason}\n\n¿Me avisas cuando puedas reagendar? Gracias por tu comprensión 💕`;
  const phone = normalizePhone(client.whatsapp || client.phone);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  
  delete order.entrega;
  storage.set('orders', orders);
  
  closeModal('cancel-entrega-modal');
  render();
  window.open(url, '_blank');
  showToast('WhatsApp enviado');
}

// ==================== PRODUCTS ====================
function openCancelProds(orderId) {
  cancelOrderId = orderId;
  const order = orders.find(o => o.id === orderId);
  if(!order) return;
  
  const container = document.getElementById('cancel-prod-list');
  const reasonInput = document.getElementById('cancel-prod-reason');
  if(reasonInput) reasonInput.value = '';
  container.innerHTML = order.products.filter(p => p.status !== 'cancelled').map(p => `
    <div class="cancel-row" onclick="toggleCancelProd(this)">
      <input type="checkbox" class="chk"/>
      <div class="cancel-row-name">${p.name}</div>
    </div>
  `).join('');
  
  document.getElementById('cancel-modal').style.display = 'flex';
}

function toggleCancelProd(row) {
  const chk = row.querySelector('.chk');
  chk.checked = !chk.checked;
  row.classList.toggle('selected', chk.checked);
}

function confirmCancelProds() {
  const order = orders.find(o => o.id === cancelOrderId);
  if(!order) return;
  const client = getClient(order.clientId);
  
  const canceledNames = [];
  document.querySelectorAll('#cancel-prod-list .cancel-row.selected').forEach(row => {
    const name = row.querySelector('.cancel-row-name').textContent;
    const prod = order.products.find(p => p.name === name);
    if(prod) {
      prod.status = 'cancelled';
      prod.cancelledAt = nowISO();
      prod.cancellationReason = document.getElementById('cancel-prod-reason')?.value.trim() || 'No se pudo conseguir';
      canceledNames.push(name);
    }
  });
  
  if(canceledNames.length === 0) {
    showToast('Selecciona al menos un producto');
    return;
  }
  
  const message = `Hola ${client.name}, lamentamos informarte que los siguientes productos no pudimos conseguirlos:\n\n${canceledNames.map(n => `- ${n}`).join('\n')}\n\n¿Te gustaría elegir otros productos o prefieres continuar solo con los disponibles? 💕`;
  const phone = normalizePhone(client.whatsapp || client.phone);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  
  storage.set('orders', orders);
  canceledNames.forEach(name => {
    const item = order.products.find(product => product.name === name);
    if(item) recordActivity({action: 'product_cancelled', entityType: 'orderItem', entityId: item.id, clientId: order.clientId, details: {orderId: order.id, productName: name, reason: item.cancellationReason}});
  });
  if(window.LuxuryFinance) {
    const resolution = document.getElementById('cancel-financial-resolution')?.value || 'credit';
    const result = window.LuxuryFinance.resolveCancellation(order.id, resolution);
    if(result?.excessCents > 0) showToast(resolution === 'refund' ? 'Reembolso registrado' : 'Saldo a favor generado');
  }
  closeModal('cancel-modal');
  render();
  window.open(url, '_blank');
  showToast('WhatsApp enviado');
}

function openAddProduct() {
  currentEditId = null;
  document.getElementById('p-name').value = '';
  document.getElementById('p-price').value = '';
  document.getElementById('p-emoji').value = '📦';
  document.getElementById('p-cat').value = '';
  document.getElementById('p-stock').value = '1';
  document.getElementById('prod-modal').style.display = 'flex';
}

function editProduct(id) {
  const prod = catalog.find(p => p.id === id);
  if(!prod) return;
  
  currentEditId = id;
  document.getElementById('p-name').value = prod.name;
  document.getElementById('p-price').value = prod.price;
  document.getElementById('p-emoji').value = prod.emoji;
  document.getElementById('p-cat').value = prod.category;
  document.getElementById('p-stock').value = prod.stock;
  document.getElementById('prod-modal').style.display = 'flex';
}

function saveProduct() {
  const name = document.getElementById('p-name').value.trim();
  const price = parseInt(document.getElementById('p-price').value);
  const emoji = document.getElementById('p-emoji').value.trim() || '📦';
  const category = document.getElementById('p-cat').value.trim();
  const stock = parseInt(document.getElementById('p-stock').value);
  
  if(!name || !price || !category) {
    showToast('Completa todos los campos');
    return;
  }
  
  const fullCatalog = storage.get('catalog', []);
  
  if(currentEditId) {
    const prod = fullCatalog.find(p => p.id === currentEditId);
    if(prod) {
      const previousPrice = Number(prod.price || 0);
      prod.name = name;
      prod.price = price;
      prod.emoji = emoji;
      prod.category = category;
      prod.stock = stock;
      prod.variants = Array.isArray(prod.variants) ? prod.variants : [];
      prod.priceHistory = Array.isArray(prod.priceHistory) ? prod.priceHistory : [];
      if(previousPrice !== price) {
        prod.priceHistory.push({price, previousPrice, effectiveAt: nowISO(), source: 'admin_update'});
        recordActivity({action: 'catalog_price_changed', entityType: 'product', entityId: prod.id, details: {previousPrice, price}});
      }
    }
    showToast('Producto actualizado');
  } else {
    const newId = fullCatalog.length > 0 ? Math.max(...fullCatalog.map(p => p.id)) + 1 : 1;
    fullCatalog.push({id: newId, name, price, emoji, category, stock, variants: [], priceHistory: [{price, effectiveAt: nowISO(), source: 'product_created'}]});
    showToast('Producto agregado');
  }
  
  storage.set('catalog', fullCatalog);
  catalog = fullCatalog;
  closeModal('prod-modal');
  renderCatalog();
}

// ==================== CSV ====================
function loadCSV(input) {
  const file = input.files[0];
  if(!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.split('\n').filter(l => l.trim());
    
    if(lines.length < 2) {
      showToast('CSV vacío o inválido');
      return;
    }
    
    const fullCatalog = storage.get('catalog', []);
    let imported = 0;
    
    // Formato esperado: nombre,precio,categoria
    for(let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if(cols.length >= 2) {
        const name = cols[0];
        const price = parseFloat(cols[1]) || 0;
        const category = cols[2] || 'General';
        
        if(name && price > 0) {
          const newId = fullCatalog.length > 0 ? Math.max(...fullCatalog.map(p => p.id)) + 1 : 1;
          fullCatalog.push({
            id: newId,
            name,
            price,
            emoji: '📦',
            category,
            stock: 1,
            variants: [],
            priceHistory: [{price, effectiveAt: nowISO(), source: 'csv_import'}]
          });
          imported++;
        }
      }
    }
    
    storage.set('catalog', fullCatalog);
    catalog = fullCatalog;
    renderCatalog();
    showToast(`${imported} productos importados`);
  };
  
  reader.readAsText(file);
}

// ==================== CLIENT VIEW ====================
function selectClientLoc(loc) {
  document.getElementById('cl-loc-indeco').classList.remove('selected-indeco', 'selected-villas');
  document.getElementById('cl-loc-villas').classList.remove('selected-indeco', 'selected-villas');
  
  if(loc === 'indeco') {
    document.getElementById('cl-loc-indeco').classList.add('selected-indeco');
  } else {
    document.getElementById('cl-loc-villas').classList.add('selected-villas');
  }
  
  selectedLocation = loc;
}

function updateClientSlots() {
  const date = document.getElementById('cl-date').value;
  if(!date || !selectedLocation) return;
  
  const dateObj = new Date(date + 'T00:00:00');
  const today = new Date();
  today.setHours(0,0,0,0);
  
  if(dateObj <= today) {
    const warn = document.getElementById('cl-date-warn');
    warn.style.display = 'block';
    warn.textContent = 'Selecciona una fecha futura (mínimo mañana)';
    return;
  }
  
  const dayOfWeek = dateObj.getDay();
  if(dayOfWeek === 0) {
    const warn = document.getElementById('cl-date-warn');
    warn.style.display = 'block';
    warn.textContent = 'Los domingos no hay entregas. Elige otro día.';
    return;
  }
  
  document.getElementById('cl-date-warn').style.display = 'none';
  
  const slots = selectedLocation === 'indeco' 
    ? ['8:30 am', '9:00 am', '9:30 am', '10:00 am', '10:30 am', '11:00 am', '11:30 am', '12:00 pm', '12:30 pm']
    : ['4:00 pm', '4:30 pm', '5:00 pm', '5:30 pm', '6:00 pm', '6:30 pm', '7:00 pm', '7:30 pm', '8:00 pm'];
  
  const container = document.getElementById('cl-slots');
  container.innerHTML = slots.map(s => 
    `<div class="slot" onclick="selectClientSlot('${s}')">${s}</div>`
  ).join('');
  
  document.getElementById('cl-slots-wrap').style.display = 'block';
  selectedSlot = null;
}

function selectClientSlot(slot) {
  selectedSlot = slot;
  document.querySelectorAll('#cl-slots .slot').forEach(s => {
    s.classList.toggle('active-slot', s.textContent === slot);
  });
}

function clientSchedule() {
  const name = document.getElementById('cl-name').value.trim();
  const date = document.getElementById('cl-date').value;
  
  if(!name || !selectedLocation || !date || !selectedSlot) {
    showToast('Completa todos los campos');
    return;
  }
  
  showToast('¡Recolección agendada! Te enviaremos confirmación por WhatsApp');
  
  // Reset form
  document.getElementById('cl-name').value = '';
  document.getElementById('cl-date').value = '';
  document.getElementById('cl-slots-wrap').style.display = 'none';
  selectedLocation = null;
  selectedSlot = null;
}

// ==================== CLIENTS ====================
function renderClients(query = '') {
  const container = document.getElementById('clients-list');
  if(!container) return;
  const q = query.trim().toLowerCase();
  const filtered = clients.filter(c => [c.name, c.phone, c.whatsapp, c.instagram].some(v => String(v || '').toLowerCase().includes(q)));
  container.innerHTML = filtered.length ? filtered.map(client => {
    const clientOrders = orders.filter(o => o.clientId === client.id);
    return `<button class="client-card" onclick="openClientDetail(${client.id})">
      <div><strong>${client.name}</strong><span>${client.phone || 'Sin celular'}</span></div>
      <div><span>${client.whatsapp ? 'WA: ' + client.whatsapp : 'Sin WhatsApp'}</span><span>${client.instagram ? '@' + client.instagram : 'Sin Instagram'}</span></div>
      <b>${clientOrders.length} pedido${clientOrders.length === 1 ? '' : 's'}</b>
    </button>`;
  }).join('') : '<div class="empty-compact">No se encontraron clientes.</div>';
}

function openClientModal(id = null) {
  currentEditId = id;
  const client = id ? getClient(id) : {};
  document.getElementById('client-modal-title').textContent = id ? 'Editar cliente' : 'Nueva clienta';
  document.getElementById('c-name').value = client.name || '';
  document.getElementById('c-phone').value = client.phone || '';
  document.getElementById('c-whatsapp').value = client.whatsapp || '';
  document.getElementById('c-instagram').value = client.instagram ? '@' + client.instagram : '';
  document.getElementById('c-email').value = client.email || '';
  document.getElementById('c-notes').value = client.notes || '';
  document.getElementById('client-modal').style.display = 'flex';
}

function saveClient() {
  const name = document.getElementById('c-name').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  const whatsapp = document.getElementById('c-whatsapp').value.trim() || phone;
  const instagram = normalizeInstagram(document.getElementById('c-instagram').value);
  const email = document.getElementById('c-email').value.trim();
  const notes = document.getElementById('c-notes').value.trim();
  if(!name) { showToast('Escribe el nombre de la clienta'); return; }
  const duplicate = clients.find(c => c.id !== currentEditId &&
    ((normalizePhone(phone || whatsapp) && normalizePhone(c.phone || c.whatsapp) === normalizePhone(phone || whatsapp)) ||
     (instagram && normalizeInstagram(c.instagram) === instagram)));
  if(duplicate) { showToast(`Ya existe una clienta con esos datos: ${duplicate.name}`); return; }
  if(currentEditId) {
    const client = getClient(currentEditId);
    Object.assign(client, {name, phone, whatsapp, instagram, email, notes, updatedAt: nowISO()});
  } else {
    const stamp = nowISO();
    const newClient = {id: clients.length ? Math.max(...clients.map(c => Number(c.id) || 0)) + 1 : 1, name, phone, whatsapp, instagram, email, notes, addresses: [], tags: [], createdAt: stamp, updatedAt: stamp};
    clients.push(newClient);
    recordActivity({action: 'client_created', entityType: 'client', entityId: newClient.id, clientId: newClient.id});
  }
  storage.set('clients', clients);
  closeModal('client-modal');
  renderClients(document.getElementById('clients-search')?.value || '');
  showToast('Cliente guardado');
}

function openClientDetail(id) {
  const client = getClient(id);
  const clientOrders = orders.filter(o => o.clientId === id);
  const active = clientOrders.filter(o => getOrderProgress(o).col !== 'entregado');
  const history = clientOrders.filter(o => getOrderProgress(o).col === 'entregado');
  const finance = window.LuxuryFinance;
  const clientTickets = finance ? finance.getTickets().filter(ticket => ticket.clientId === id) : [];
  const financialTotals = clientTickets.reduce((result, ticket) => {
    const values = finance.calculate(ticket);
    result.total += values.totalCents; result.paid += values.amountPaidCents + values.creditAppliedCents; result.balance += values.balanceDueCents;
    return result;
  }, {total: 0, paid: 0, balance: 0});
  const nextPayment = finance?.getNextScheduledPayment(id);
  const overdueCount = finance ? finance.getSchedules().filter(item => item.status === 'overdue' && clientTickets.some(ticket => ticket.id === item.ticketId)).length : 0;
  const orderBlock = list => list.length ? list.map(o => `<div class="client-order"><strong>Pedido #${o.id}</strong><span>${getOrderProgress(o).label} · $${getActiveTotal(o).toLocaleString()}</span><ul>${o.products.map(p => `<li>${p.name} — ${p.status}</li>`).join('')}</ul></div>`).join('') : '<div class="empty-compact">Sin pedidos.</div>';
  document.getElementById('client-detail-content').innerHTML = `
    <div class="client-detail-head"><div><h2>${client.name}</h2><p>${client.whatsapp || client.phone || 'Sin teléfono'}${client.instagram ? ' · @' + client.instagram : ''}${client.email ? ' · ' + client.email : ''}</p><p>${client.notes || ''}</p></div>
    <button class="btn-secondary" onclick="closeModal('client-detail-modal');openClientModal(${id})">Editar</button></div>
    ${finance ? `<div class="finance-numbers"><div><span>Total comprado</span><strong>${finance.formatMoney(financialTotals.total)}</strong></div><div><span>Total pagado</span><strong>${finance.formatMoney(financialTotals.paid)}</strong></div><div><span>Saldo pendiente</span><strong>${finance.formatMoney(financialTotals.balance)}</strong></div><div><span>Saldo a favor</span><strong>${finance.formatMoney(finance.calculateClientCredit(id))}</strong></div><div><span>Próximo pago</span><strong>${nextPayment ? finance.formatMoney(nextPayment.expectedAmountCents-nextPayment.coveredAmountCents) : 'Sin próximos'}</strong></div><div><span>Pagos vencidos</span><strong>${overdueCount}</strong></div></div><h3>Tickets</h3>${clientTickets.map(ticket => `<button class="client-order" onclick="location.href='tickets.html'"><strong>${ticket.folio}</strong><span>${finance.formatMoney(finance.calculate(ticket).balanceDueCents)} pendiente</span></button>`).join('') || '<div class="empty-compact">Sin tickets.</div>'}` : ''}
    <h3>Pedidos activos</h3>${orderBlock(active)}<h3>Historial</h3>${orderBlock(history)}`;
  document.getElementById('client-detail-modal').style.display = 'flex';
}

// ==================== UTILS ====================
function closeModal(modalId, event) {
  if(event && event.target.classList.contains('modal')) return;
  document.getElementById(modalId).style.display = 'none';
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  enhanceOrderModal();
  const cancelList = document.getElementById('cancel-prod-list');
  if(cancelList && !document.getElementById('cancel-prod-reason')) {
    cancelList.insertAdjacentHTML('afterend', '<div class="field"><label>Motivo de cancelación</label><textarea id="cancel-prod-reason" placeholder="Motivo"></textarea></div>');
  }
  render();
  
  // Set min date for date inputs
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];
  
  const dateInputs = document.querySelectorAll('input[type="date"]');
  dateInputs.forEach(input => input.min = minDate);
});
