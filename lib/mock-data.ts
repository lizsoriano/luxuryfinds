export type ProductMock = {
  id: string;
  name: string;
  category: string;
  variant: string;
  price: number;
  availability: "Entrega inmediata" | "Por pedido";
  tone: "rose" | "cream" | "wine" | "beige";
};

export const mockProducts: ProductMock[] = [
  { id: "rare-beauty-blush", name: "Soft Pinch Liquid Blush", category: "Beauty · Rare Beauty", variant: "Hope", price: 750, availability: "Entrega inmediata", tone: "rose" },
  { id: "new-balance-530", name: "New Balance 530", category: "Calzado · New Balance", variant: "White / Silver · Talla 24", price: 2850, availability: "Por pedido", tone: "cream" },
  { id: "coach-tabby", name: "Tabby Shoulder Bag 20", category: "Bolsos · Coach", variant: "Dark Stone", price: 6990, availability: "Por pedido", tone: "wine" },
  { id: "dior-lip-glow", name: "Dior Addict Lip Glow", category: "Beauty · Dior", variant: "Rosewood", price: 890, availability: "Entrega inmediata", tone: "beige" },
];

export const mockAccountPurchases = [
  { ticket: "LF-2026-000128", name: "New Balance 530", state: "Al corriente", detail: "Pago 5 de 8", amount: "$1,575 pendiente" },
  { ticket: "LF-2026-000104", name: "Soft Pinch Liquid Blush", state: "Recibido en La Paz", detail: "Listo para programar", amount: "Pagado" },
];

export const mockAdminActivity = [
  { label: "Comprobante recibido", meta: "Mariana López · LF-2026-000131", time: "Hace 8 min" },
  { label: "Producto listo para ordenar", meta: "New Balance 530 · LF-2026-000128", time: "Hace 24 min" },
  { label: "Entrega programada", meta: "Sofía Castro · Viernes 4:30 p. m.", time: "Hace 1 h" },
];
