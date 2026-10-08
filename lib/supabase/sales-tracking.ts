import { adminDb, adminStorage, PRODUCT_IMAGE_BUCKET } from "./business";
import { missingRelation, related, SALES_MIGRATION, salesTarget } from "./sales";
import { orderStage, saleStage, type SalesStage } from "../sales-feed";

export const TRACKING_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export async function getTrackingLink(value: string) {
  const target = salesTarget(value);
  if (!target) return { token: null, unavailable: false };
  const { data, error } = await adminDb().from("sale_tracking_links").select("token").eq(target.column, target.id).is("revoked_at", null).maybeSingle();
  if (missingRelation(error)) return { token: null, unavailable: true };
  if (error) throw new Error(error.message);
  return { token: data?.token as string | null ?? null, unavailable: false };
}
export function trackingError(error: { message: string; code?: string }) {
  return missingRelation(error) ? `Aplica ${SALES_MIGRATION} para activar el seguimiento.` : error.message;
}

export type PublicTracking = { firstName: string | null; stage: SalesStage; createdAt: string; lines: Array<{ id: string; name: string; variant: string | null; quantity: number; image: string | null; stage: SalesStage; logisticsStatus: string | null; updatedAt: string | null }> };
/** Separate public allowlist. No payment, cost, address, phone or internal notes are read. */
export async function getPublicTracking(token: string): Promise<PublicTracking | null> {
  if (!TRACKING_TOKEN.test(token)) return null;
  const db = adminDb();
  const { data: link, error } = await db.from("sale_tracking_links").select("sale_id,order_id").eq("token", token).is("revoked_at", null).maybeSingle();
  if (missingRelation(error)) return null;
  if (error) throw new Error("No pudimos consultar el seguimiento.");
  if (!link) return null;
  const sale = !!link.sale_id;
  const id = (link.sale_id ?? link.order_id) as string;
  const { data: parent, error: parentError } = await db.from(sale ? "sales" : "orders").select(sale ? "id,status,sold_at,client_id" : "id,status,created_at,client_id").eq("id", id).maybeSingle();
  if (parentError) throw new Error("No pudimos consultar la compra.");
  if (!parent) return null;
  const row = parent as unknown as { status: string; sold_at?: string; created_at?: string; client_id: string | null };
  const [clients, items] = await Promise.all([
    related<{ id: string; first_name: string }>("clients", "id,first_name", "id", row.client_id ? [row.client_id] : []),
    related<{ id: string; product_id: string | null; quantity: number; product_name_snapshot?: string; variant_name_snapshot?: string | null; products?: { name: string } | null; product_variants?: { name: string } | null }>(sale ? "sale_items" : "order_items", sale ? "id,product_id,quantity,product_name_snapshot,variant_name_snapshot" : "id,product_id,quantity,products(name),product_variants(name)", sale ? "sale_id" : "order_id", [id]),
  ]);
  const [tickets, images] = await Promise.all([
    sale ? [] : related<{ id: string; order_item_id: string; product_name_snapshot: string; variant_name_snapshot: string | null; image_storage_key_snapshot: string | null; logistics_status: string; updated_at: string }>("tickets", "id,order_item_id,product_name_snapshot,variant_name_snapshot,image_storage_key_snapshot,logistics_status,updated_at", "order_item_id", items.map(i => i.id)),
    related<{ id: string; product_id: string; storage_key: string; sort_order: number }>("product_images", "id,product_id,storage_key,sort_order", "product_id", items.flatMap(i => i.product_id ? [i.product_id] : [])),
  ]);
  const rankTickets = tickets.map(t => ({ ...t, agreed_total_cents: 0, paid_principal_cents: 0 }));
  const stage = sale ? saleStage(row.status) : orderStage(row.status, rankTickets);
  const lines = items.map(i => {
    const ticket = tickets.find(t => t.order_item_id === i.id);
    const key = ticket?.image_storage_key_snapshot ?? images.filter(image => image.product_id === i.product_id).sort((a,b) => a.sort_order - b.sort_order)[0]?.storage_key;
    return { id: i.id, name: i.product_name_snapshot ?? ticket?.product_name_snapshot ?? i.products?.name ?? "Artículo", variant: i.variant_name_snapshot ?? ticket?.variant_name_snapshot ?? i.product_variants?.name ?? null, quantity: Number(i.quantity), image: key ? adminStorage().from(PRODUCT_IMAGE_BUCKET).getPublicUrl(key).data.publicUrl : null, stage: stage === "CANCELLED" ? stage : ticket ? orderStage("CONFIRMED", [{ ...ticket, agreed_total_cents: 0, paid_principal_cents: 0 }]) : stage, logisticsStatus: stage === "CANCELLED" ? "CANCELLED_INCIDENT" : sale ? "DELIVERED" : ticket?.logistics_status ?? null, updatedAt: ticket?.updated_at ?? null };
  });
  // Check again after dependent reads: a link revoked during the request is not served.
  const { data: stillActive, error: activeError } = await db.from("sale_tracking_links").select("token").eq("token", token).is("revoked_at", null).maybeSingle();
  if (activeError) throw new Error("No pudimos consultar el seguimiento.");
  if (!stillActive) return null;
  return { firstName: clients[0]?.first_name.trim().split(/\s+/)[0] || null, stage, createdAt: row.sold_at ?? row.created_at!, lines };
}
