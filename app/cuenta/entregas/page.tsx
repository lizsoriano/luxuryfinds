import { AccountPurchases } from "../../../components/account/AccountPurchases";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getAccountData } from "../../../lib/supabase/account";

export const dynamic = "force-dynamic";
const states: Record<string, string> = { BOOKED: "Programada", COMPLETED: "Completada", CANCELLED: "Cancelada" };
export default async function DeliveriesPage() {
  const data = await getAccountData();
  const tickets = data.profile ? [...data.tickets, ...data.salePurchases].filter(ticket => !["DELIVERED", "CANCELLED_INCIDENT"].includes(ticket.logistics_status)) : [];
  return <main className="account-content"><PageHeader eyebrow="MI CUENTA" title="Mis entregas" description="Sigue el avance de los productos que estás esperando." />
    {tickets.length ? <AccountPurchases tickets={tickets} /> : <EmptyState title="No tienes entregas pendientes" description="Aquí aparecerán tus productos pendientes de entrega." />}
    {data.profile && data.deliveries.length > 0 && <Card className="proof-card"><h2>Entregas registradas</h2>{data.deliveries.map(delivery => <p key={delivery.id}>{data.tickets.find(ticket => ticket.id === delivery.ticket_id)?.ticket_number ?? "Entrega"} · {states[delivery.status] ?? delivery.status}</p>)}</Card>}
  </main>;
}
