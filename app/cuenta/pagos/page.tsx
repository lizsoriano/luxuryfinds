import { PaymentProofForm } from "../../../components/account/PaymentProofForm";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatMoney, PAYMENT_METHOD_LABELS } from "../../../lib/format";
import { getAccountData } from "../../../lib/supabase/account";

export const dynamic = "force-dynamic";
export default async function PaymentsPage() {
  const data = await getAccountData();
  if (!data.profile) return <main className="account-content"><EmptyState title="Tu perfil aún no está listo" description="Contacta a Luxury Finds para revisar tu cuenta." /></main>;
  return <main className="account-content"><PageHeader eyebrow="MI CUENTA" title="Mis pagos" />
    <section className="account-grid"><Card className="proof-card"><h2>Saldo de mis compras</h2>{data.tickets.length ? data.tickets.map(ticket => <p key={ticket.id}><strong>{ticket.ticket_number} · {ticket.product_name_snapshot}</strong><br />{formatMoney(Math.max(0, ticket.agreed_total_cents - ticket.paid_principal_cents))} pendiente</p>) : <p>No tienes saldos pendientes registrados.</p>}</Card>
    <Card className="proof-card"><h2>Próximos pagos</h2>{data.installments.filter(item => item.status !== "PAID").map(item => <p key={item.id}>Pago {item.installment_number} · {item.due_at.slice(0, 10)}<br />{formatMoney(Math.max(0, item.amount_cents - item.paid_cents))} pendiente</p>)}{!data.installments.some(item => item.status !== "PAID") && <p>No tienes pagos programados pendientes.</p>}</Card></section>
    <section className="proof-section"><Card className="proof-card"><h2>Historial de pagos</h2>{data.payments.length ? data.payments.map(payment => <p key={payment.id}><strong>{formatMoney(payment.amount_cents)}</strong> · {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}<br />{payment.effective_paid_at.slice(0, 10)}{payment.reference && <> · {payment.reference}</>}</p>) : <p>Aún no tienes pagos registrados.</p>}</Card>
    {data.tickets.length > 0 && <Card className="proof-card"><h2>Reportar un pago</h2><PaymentProofForm tickets={data.tickets.map(({ id, ticket_number }) => ({ id, ticket_number }))} /></Card>}</section>
  </main>;
}
