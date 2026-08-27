(function(global) {
  'use strict';
  const storage = {
    get(key, fallback = []) {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
      } catch(error) {
        console.error(`No se pudo leer ${key}`, error);
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  };
  const defaultProducts = [
    {id:1,name:'Foundation MAC NC25',price:850,emoji:'💄',category:'Base',stock:1},
    {id:2,name:'Lipstick Ruby Woo',price:520,emoji:'💋',category:'Labial',stock:1},
    {id:3,name:'Perfume Chanel',price:2800,emoji:'🌸',category:'Fragancia',stock:0},
    {id:4,name:'Mascara Lash Princess',price:320,emoji:'👁️',category:'Ojos',stock:1},
    {id:5,name:'Serum Vitamina C',price:680,emoji:'✨',category:'Cuidado',stock:1},
    {id:6,name:'Blush NARS Orgasm',price:750,emoji:'🎀',category:'Mejillas',stock:1},
    {id:7,name:'Primer The Ordinary',price:280,emoji:'💧',category:'Base',stock:1},
    {id:8,name:'Setting Spray Urban',price:420,emoji:'💦',category:'Fijador',stock:1}
  ];

  const repository = {
    storage,
    getClients: () => storage.get('clients', []),
    getOrders: () => storage.get('orders', []),
    getProducts: () => storage.get('catalog', defaultProducts),
    getActivity: () => storage.get('activityLog', []),
    saveClients: clients => storage.set('clients', clients),
    saveOrders: orders => storage.set('orders', orders),
    saveCatalog: products => storage.set('catalog', products),
    saveActivity: activity => storage.set('activityLog', activity),
    getDeliveries() {
      return this.getOrders().filter(order => order.entrega).map(order => ({orderId: order.id, clientId: order.clientId, ...order.entrega}));
    },
    getClient(id) {
      return this.getClients().find(client => String(client.id) === String(id)) || null;
    },
    getClientOrders(clientId) {
      return this.getOrders().filter(order => String(order.clientId) === String(clientId));
    },
    getClientActivity(clientId) {
      return this.getActivity().filter(event => String(event.clientId) === String(clientId)).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    },
    getPortalClientId() {
      return localStorage.getItem('glamstudio_portal_client_id');
    },
    setPortalClientId(clientId) {
      localStorage.setItem('glamstudio_portal_client_id', String(clientId));
    },
    clearPortalClientId() {
      localStorage.removeItem('glamstudio_portal_client_id');
    },
    activeTotal(order) {
      return (order.products || []).reduce((sum, item) => item.status === 'cancelled' ? sum : sum + Number(item.subtotal || (item.quantity || 1) * (item.unitPrice || 0)), 0);
    },
    exportBackup() {
      return {
        app: 'luxury-finds',
        exportedAt: new Date().toISOString(),
        schemaVersion: Number(localStorage.getItem('glamstudio_schema_version') || 0),
        data: {clients: this.getClients(), orders: this.getOrders(), catalog: this.getProducts(), activityLog: this.getActivity(), tickets: storage.get('tickets',[]), paymentPlans: storage.get('paymentPlans',[]), scheduledPayments: storage.get('scheduledPayments',[]), payments: storage.get('payments',[]), paymentProofs: storage.get('paymentProofs',[]), creditMovements: storage.get('creditMovements',[]), refunds: storage.get('refunds',[]), paymentPlanTemplates: storage.get('paymentPlanTemplates',[])}
      };
    },
    importBackup(backup) {
      if(!backup || backup.app !== 'luxury-finds' || !backup.data) throw new Error('El archivo no es un respaldo de Luxury Finds.');
      const {clients, orders, catalog, activityLog = []} = backup.data;
      if(!Array.isArray(clients) || !Array.isArray(orders) || !Array.isArray(catalog) || !Array.isArray(activityLog)) throw new Error('El respaldo tiene una estructura inválida.');
      if(orders.some(order => order.clientId == null || !Array.isArray(order.products))) throw new Error('El respaldo contiene pedidos inválidos.');
      this.saveClients(clients); this.saveOrders(orders); this.saveCatalog(catalog); this.saveActivity(activityLog);
      for(const key of ['tickets','paymentPlans','scheduledPayments','payments','paymentProofs','creditMovements','refunds','paymentPlanTemplates']) {
        if(backup.data[key] != null) {
          if(!Array.isArray(backup.data[key])) throw new Error(`La colección ${key} es inválida.`);
          storage.set(key, backup.data[key]);
        }
      }
      localStorage.setItem('glamstudio_schema_version', String(Number(backup.schemaVersion) || 6));
      return true;
    }
  };

  global.GlamData = repository;
  if(typeof document !== 'undefined' && document.currentScript && !global.LuxuryFinance) {
    const financeUrl = new URL('finance.js', document.currentScript.src).href;
    document.write(`<script src="${financeUrl}"><\/script>`);
  }
})(window);
