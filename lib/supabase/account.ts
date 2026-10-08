import { getSaleItemFulfillment, related } from "./sales";
import { getClientProfile } from "./auth";
import { getClientReservations } from "./incoming-reservations";

export async function getAccountData() {
  const { supabase, user, profile } = await getClientProfile();
  if (!profile) return { user, profile: null };
  const reservations = await getClientReservations(user.id);
  // Service-role reads are scoped to the verified session's client, never a request ID.
  const ownSales = (await related<{id: string; sale_number: string; status: string}>("sales", "id,sale_number,status", "client_id", [user.id])).filter(s => s.status === "COMPLETED");
  const saleItems = await related<{ id: string; sale_id: string; product_name_snapshot: string; variant_name_snapshot: string | null }>("sale_items", "id,sale_id,product_name_snapshot,variant_name_snapshot", "sale_id", ownSales.map(s => s.id));
  const fulfillment = await getSaleItemFulfillment(saleItems.map(i => i.id));
  const salePurchases = saleItems.flatMap(item => {
    const state = fulfillment.rows.find(f => f.id === item.id);
    if (!state || state.logistics_status === "DELIVERED") return [];
    return [{ id: `sale-${item.id}`, ticket_number: ownSales.find(s => s.id === item.sale_id)?.sale_number ?? "Venta", product_name_snapshot: item.product_name_snapshot, variant_name_snapshot: item.variant_name_snapshot, financial_status: "PAID", logistics_status: state.logistics_status, agreed_total_cents: 0, paid_principal_cents: 0 }];
  });

  const [orders, tickets, plans, installments, fees, notifications, deliveries] = await Promise.all([
    supabase.schema("luxury_finds").from("orders").select("id, status, created_at, order_items(id, quantity)").order("created_at", { ascending: false }),
    supabase.schema("luxury_finds").from("tickets").select("id, ticket_number, product_name_snapshot, variant_name_snapshot, financial_status, logistics_status, agreed_total_cents, paid_principal_cents, image_storage_key_snapshot, created_at").order("created_at", { ascending: false }),
    supabase.schema("luxury_finds").from("payment_plans").select("id, ticket_id, mode, status, agreed_total_cents, number_of_weeks, start_date, due_date"),
    supabase.schema("luxury_finds").from("installments").select("id, payment_plan_id, installment_number, due_at, amount_cents, paid_cents, status").order("due_at"),
    supabase.schema("luxury_finds").from("late_fees").select("id, ticket_id, amount_cents, paid_cents, status"),
    supabase.schema("luxury_finds").from("notifications").select("id, ticket_id, type, title, body, read_at, created_at").order("created_at", { ascending: false }),
    supabase.schema("luxury_finds").from("delivery_bookings").select("id, ticket_id, delivery_type, status, booked_at, cancelled_at, completed_at").order("booked_at", { ascending: false }),
  ]);

  const results = { orders, tickets, plans, installments, fees, notifications, deliveries };
  const failed = Object.entries(results).find(([, result]) => result.error);
  if (failed) throw new Error(`No fue posible cargar ${failed[0]}: ${failed[1].error?.message}`);
  // Payments lack an authenticated SELECT grant. Scope the service read to
  // ticket IDs returned by the caller's RLS-protected session, never form IDs.
  const payments = await related<{ id: string; ticket_id: string; amount_cents: number; method: string; effective_paid_at: string; reference: string | null }>(
    "payments", "id,ticket_id,amount_cents,method,effective_paid_at,reference", "ticket_id", (tickets.data ?? []).map(ticket => ticket.id),
  );
  payments.sort((a, b) => b.effective_paid_at.localeCompare(a.effective_paid_at));

  return {
    user,
    profile,
    reservations,
    salePurchases,
    orders: orders.data ?? [],
    tickets: tickets.data ?? [],
    plans: plans.data ?? [],
    installments: installments.data ?? [],
    payments,
    fees: fees.data ?? [],
    notifications: notifications.data ?? [],
    deliveries: deliveries.data ?? [],
  };
}
