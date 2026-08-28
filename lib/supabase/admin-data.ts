import { createAdminSupabaseClient } from "./admin";

export async function getAdminDashboardData() {
  const supabase = createAdminSupabaseClient();
  const [proofs, installments, tickets, deliveries, activity] = await Promise.all([
    supabase.schema("luxury_finds").from("payment_proofs").select("id, reported_amount_cents, payment_method, status, uploaded_at, tickets(ticket_number, clients(first_name, last_name))").eq("status", "PENDING").order("uploaded_at", { ascending: false }).limit(10),
    supabase.schema("luxury_finds").from("installments").select("id, amount_cents, paid_cents, due_at, status").in("status", ["PENDING", "PARTIAL", "OVERDUE"]),
    supabase.schema("luxury_finds").from("tickets").select("id, logistics_status, product_name_snapshot, ticket_number"),
    supabase.schema("luxury_finds").from("delivery_bookings").select("id, delivery_type, status, delivery_slots(starts_at)"),
    supabase.schema("luxury_finds").from("activity_logs").select("id, action, entity_type, entity_id, created_at").order("created_at", { ascending: false }).limit(6),
  ]);
  const results = { proofs, installments, tickets, deliveries, activity };
  const failed = Object.entries(results).find(([, result]) => result.error);
  if (failed) throw new Error(`No fue posible cargar ${failed[0]}: ${failed[1].error?.message}`);
  return {
    proofs: proofs.data ?? [],
    installments: installments.data ?? [],
    tickets: tickets.data ?? [],
    deliveries: deliveries.data ?? [],
    activity: activity.data ?? [],
  };
}
