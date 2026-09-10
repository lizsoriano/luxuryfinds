import { adminDb } from "./business";

// ---------------------------------------------------------------------------
// Pedidos = the existing `orders` table (created by the public checkout, see
// app/(public)/checkout/actions.ts). Every order starts as DRAFT with no
// tickets; confirming one here is what generates its `tickets` rows and
// allocates stock. This reads/writes the original catalogue schema
// (orders/order_items/tickets), which is part of database/schema.sql and does
// NOT depend on migrations 002/003.
// ---------------------------------------------------------------------------

export type OrderStatus = "DRAFT" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

export type OrderListRow = {
  id: string;
  origin: "WEBSITE" | "ADMIN_MANUAL";
  status: OrderStatus;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  client: { first_name: string; last_name: string; phone: string } | null;
  itemCount: number;
  totalCents: number;
};

export type OrderItemRow = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit_price_cents: number;
  store_name: string | null;
  notes: string | null;
  productName: string | null;
  variantName: string | null;
  catalogType: "ON_DEMAND" | "IMMEDIATE" | null;
};

export type OrderTicketRow = {
  id: string;
  ticket_number: string;
  order_item_id: string;
  product_name_snapshot: string;
  variant_name_snapshot: string | null;
  quantity: number;
  agreed_total_cents: number;
  payment_mode: string;
  financial_status: string;
  logistics_status: string;
  created_at: string;
};

const ORDER_PAGE_SIZE = 20;
const ORDER_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "CANCELLED", "COMPLETED"];

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function listOrders(query: { search?: string; status?: string; page?: number } = {}) {
  const page = Math.max(1, query.page ?? 1);
  const from = (page - 1) * ORDER_PAGE_SIZE;
  const db = adminDb();

  let clientIds: string[] | null = null;
  if (query.search?.trim()) {
    const term = `%${query.search.trim()}%`;
    const { data, error } = await db
      .from("clients")
      .select("id")
      .or(`first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term}`);
    if (error) throw new Error(error.message);
    clientIds = (data ?? []).map((row) => row.id as string);
    if (!clientIds.length) {
      return { orders: [] as OrderListRow[], page, pageSize: ORDER_PAGE_SIZE, total: 0, hasNextPage: false };
    }
  }

  let builder = db
    .from("orders")
    .select(
      "id, origin, status, created_at, confirmed_at, cancelled_at, clients(first_name, last_name, phone), order_items(quantity, unit_price_cents)",
      { count: "exact" },
    );

  if (query.status && ORDER_STATUSES.includes(query.status as OrderStatus)) {
    builder = builder.eq("status", query.status);
  }
  if (clientIds) builder = builder.in("client_id", clientIds);

  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + ORDER_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  const orders: OrderListRow[] = (data ?? []).map((row) => {
    const items = (row.order_items ?? []) as Array<{ quantity: number; unit_price_cents: number }>;
    return {
      id: row.id as string,
      origin: row.origin as OrderListRow["origin"],
      status: row.status as OrderStatus,
      created_at: row.created_at as string,
      confirmed_at: row.confirmed_at as string | null,
      cancelled_at: row.cancelled_at as string | null,
      client: relation(row.clients as unknown as { first_name: string; last_name: string; phone: string }[]),
      itemCount: items.reduce((sum, item) => sum + Number(item.quantity), 0),
      totalCents: items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price_cents), 0),
    };
  });

  return {
    orders,
    page,
    pageSize: ORDER_PAGE_SIZE,
    total: count ?? orders.length,
    hasNextPage: (count ?? 0) > from + ORDER_PAGE_SIZE,
  };
}

export async function getOrderDetail(id: string) {
  const db = adminDb();
  const { data: order, error } = await db
    .from("orders")
    .select(
      "id, origin, status, client_notes, internal_notes, created_at, confirmed_at, cancelled_at, client_id, clients(id, first_name, last_name, phone, email)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;

  const { data: items, error: itemsError } = await db
    .from("order_items")
    .select(
      "id, product_id, variant_id, quantity, unit_price_cents, store_name, notes, products(name, catalog_type), product_variants(name)",
    )
    .eq("order_id", id)
    .order("created_at", { ascending: true });
  if (itemsError) throw new Error(itemsError.message);

  const orderItems: OrderItemRow[] = (items ?? []).map((row) => {
    const product = relation(row.products as unknown as { name: string; catalog_type: string }[]);
    const variant = relation(row.product_variants as unknown as { name: string }[]);
    return {
      id: row.id as string,
      product_id: row.product_id as string | null,
      variant_id: row.variant_id as string | null,
      quantity: Number(row.quantity),
      unit_price_cents: Number(row.unit_price_cents),
      store_name: row.store_name as string | null,
      notes: row.notes as string | null,
      productName: product?.name ?? null,
      variantName: variant?.name ?? null,
      catalogType: (product?.catalog_type as OrderItemRow["catalogType"]) ?? null,
    };
  });

  const orderItemIds = orderItems.map((item) => item.id);
  let tickets: OrderTicketRow[] = [];
  if (orderItemIds.length) {
    const { data: ticketRows, error: ticketsError } = await db
      .from("tickets")
      .select(
        "id, ticket_number, order_item_id, product_name_snapshot, variant_name_snapshot, quantity, agreed_total_cents, payment_mode, financial_status, logistics_status, created_at",
      )
      .in("order_item_id", orderItemIds)
      .order("created_at", { ascending: true });
    if (ticketsError) throw new Error(ticketsError.message);
    tickets = (ticketRows ?? []) as OrderTicketRow[];
  }

  return {
    order: {
      id: order.id as string,
      origin: order.origin as string,
      status: order.status as OrderStatus,
      client_notes: order.client_notes as string | null,
      internal_notes: order.internal_notes as string | null,
      created_at: order.created_at as string,
      confirmed_at: order.confirmed_at as string | null,
      cancelled_at: order.cancelled_at as string | null,
      client_id: order.client_id as string,
    },
    client: relation(
      order.clients as unknown as { id: string; first_name: string; last_name: string; phone: string; email: string | null }[],
    ),
    items: orderItems,
    tickets,
  };
}
