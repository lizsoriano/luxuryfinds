import { adminDb, DEFAULT_BUSINESS_ID } from "./business";
import { STAFF_SELECTS } from "./staff-schema";
export const STAFF_RECEPTION_MIGRATION = "database/migrations/015_staff_reception.sql";
export type StaffShipment = { id: string; shipment_number: string; carrier: string; tracking_number: string | null; estimated_arrival: string | null; status: string };
export type StaffShipmentLine = { id: string; name: string; variant_label: string | null; ticket_number: string | null; client_name: string | null; assignment_id: string | null; expected_quantity: number; received_good_quantity: number; received_damaged_quantity: number; missing_quantity: number };
function schemaError(message: string) {
  if (message.includes("staff_shipment_lines") && (message.includes("schema cache") || message.includes("does not exist"))) return new Error(`Falta aplicar ${STAFF_RECEPTION_MIGRATION} en el editor SQL de Supabase.`);
  if (message.includes("shipments") && (message.includes("schema cache") || message.includes("does not exist"))) return new Error("Falta aplicar database/migrations/014_shipments.sql en el editor SQL de Supabase.");
  return new Error(message);
}
export async function listStaffShipments(page = 1) {
  const from = (Math.max(1, page) - 1) * 30;
  const { data, error, count } = await adminDb().from("shipments").select(STAFF_SELECTS.shipments, { count: "exact" }).eq("business_id", DEFAULT_BUSINESS_ID).in("status", ["IN_TRANSIT", "PARTIALLY_RECEIVED"]).order("created_at", { ascending: false }).range(from, from + 29);
  if (error) throw schemaError(error.message);
  return { shipments: (data ?? []) as StaffShipment[], hasNext: (count ?? 0) > from + 30 };
}
export async function getStaffShipment(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data, error } = await adminDb().from("shipments").select(STAFF_SELECTS.shipments).eq("business_id", DEFAULT_BUSINESS_ID).eq("id", id).maybeSingle();
  if (error) throw schemaError(error.message);
  if (!data) return null;
  const lines: StaffShipmentLine[] = [];
  for (let offset = 0; ; offset += 150) {
    const result = await adminDb().from("staff_shipment_lines").select(STAFF_SELECTS.shipmentLines).eq("shipment_id", id).eq("status", "ACTIVE").order("position").range(offset, offset + 149);
    if (result.error) throw schemaError(result.error.message);
    lines.push(...(result.data ?? []) as StaffShipmentLine[]);
    if ((result.data?.length ?? 0) < 150) break;
  }
  return { shipment: data as StaffShipment, lines };
}
