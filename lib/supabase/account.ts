import { getClientProfile } from "./auth";

export async function getAccountData() {
  const { supabase, user, profile } = await getClientProfile();
  if (!profile) return { user, profile: null };

  const [orders, tickets, plans, installments, payments, fees, notifications, deliveries] = await Promise.all([
    supabase.schema("luxury_finds").from("orders").select("id, status, created_at, order_items(id, quantity)").order("created_at", { ascending: false }),
    supabase.schema("luxury_finds").from("tickets").select("id, ticket_number, product_name_snapshot, variant_name_snapshot, financial_status, logistics_status, agreed_total_cents, paid_principal_cents, image_storage_key_snapshot, created_at").order("created_at", { ascending: false }),
    supabase.schema("luxury_finds").from("payment_plans").select("id, ticket_id, mode, status, agreed_total_cents, number_of_weeks, start_date, due_date"),
    supabase.schema("luxury_finds").from("installments").select("id, payment_plan_id, installment_number, due_at, amount_cents, paid_cents, status").order("due_at"),
    supabase.schema("luxury_finds").from("payments").select("id, ticket_id, amount_cents, method, effective_paid_at, reference").order("effective_paid_at", { ascending: false }),
    supabase.schema("luxury_finds").from("late_fees").select("id, ticket_id, amount_cents, paid_cents, status"),
    supabase.schema("luxury_finds").from("notifications").select("id, ticket_id, type, title, body, read_at, created_at").order("created_at", { ascending: false }),
    supabase.schema("luxury_finds").from("delivery_bookings").select("id, ticket_id, delivery_type, status, booked_at, cancelled_at, completed_at").order("booked_at", { ascending: false }),
  ]);

  const results = { orders, tickets, plans, installments, payments, fees, notifications, deliveries };
  const failed = Object.entries(results).find(([, result]) => result.error);
  if (failed) throw new Error(`No fue posible cargar ${failed[0]}: ${failed[1].error?.message}`);

  return {
    user,
    profile,
    orders: orders.data ?? [],
    tickets: tickets.data ?? [],
    plans: plans.data ?? [],
    installments: installments.data ?? [],
    payments: payments.data ?? [],
    fees: fees.data ?? [],
    notifications: notifications.data ?? [],
    deliveries: deliveries.data ?? [],
  };
}
