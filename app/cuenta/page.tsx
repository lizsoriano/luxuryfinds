import { PaymentProofForm } from "../../components/account/PaymentProofForm";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import { getAccountData } from "../../lib/supabase/account";

export const dynamic = "force-dynamic";

const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mazatlan" }).format(new Date(value));
const logistics: Record<string, string> = { WAITING_TO_ORDER: "Esperando pedido", READY_TO_ORDER: "Listo para ordenar", ORDERED: "Ordenado", IN_TRANSIT: "En camino", RECEIVED_LA_PAZ: "Recibido en La Paz", READY_FOR_DELIVERY: "Listo para entrega", DELIVERY_SCHEDULED: "Entrega programada", DELIVERED: "Entregado", CANCELLED_INCIDENT: "Cancelado" };

export default async function AccountPage() {
  let data;
  try { data = await getAccountData(); }
  catch { return <main className="account-content"><EmptyState title="No pudimos cargar tu cuenta" description="Intenta de nuevo en unos minutos."/></main>; }
  if (!data.profile) return <main className="account-content"><EmptyState title="Tu perfil aún no está listo" description="Tu acceso existe en Supabase Auth, pero falta crear tu perfil de cliente. Contacta a Luxury Finds."/></main>;

  const tickets = data.tickets;
  const activeTickets = tickets.filter((ticket) => !["DELIVERED", "CANCELLED_INCIDENT"].includes(ticket.logistics_status));
  const nextInstallment = data.installments.find((item) => ["PENDING", "PARTIAL", "OVERDUE"].includes(item.status));
  const unread = data.notifications.filter((item) => !item.read_at).length;
  const activePlan = data.plans.find((plan) => plan.status === "ACTIVE");
  const planInstallments = activePlan ? data.installments.filter((item) => item.payment_plan_id === activePlan.id) : [];
  const paidInstallments = planInstallments.filter((item) => item.status === "PAID").length;
  const progress = planInstallments.length ? Math.round((paidInstallments / planInstallments.length) * 100) : 0;
  const firstName = data.profile.first_name;

  return <main className="account-content"><PageHeader eyebrow={new Intl.DateTimeFormat("es-MX", { dateStyle: "full", timeZone: "America/Mazatlan" }).format(new Date()).toUpperCase()} title={<>Hola, {firstName} <em>♡</em></>} description="Aquí tienes un resumen de tus compras y próximos pasos."/><section className="account-stats"><StatCard label="TU PRÓXIMO PAGO" value={nextInstallment ? money(nextInstallment.amount_cents - nextInstallment.paid_cents) : "Sin pendientes"} note={nextInstallment ? date(nextInstallment.due_at) : "Estás al corriente"} tone="rose"/><StatCard label="COMPRAS ACTIVAS" value={String(activeTickets.length)} note={data.deliveries.some((item) => item.status === "BOOKED") ? "Tienes una entrega programada" : "Consulta el avance abajo"}/><StatCard label="NOTIFICACIONES" value={String(unread)} note={unread ? "Tienes novedades pendientes" : "No hay nuevas hoy"}/></section><section className="account-grid"><div><div className="section-heading"><div><p className="micro-label">MIS COMPRAS</p><h2>En movimiento</h2></div><Button href="/cuenta/compras" variant="secondary" size="small">Ver todas</Button></div>{activeTickets.length ? <div className="purchase-list">{activeTickets.slice(0, 4).map((ticket, index)=><Card className="purchase-row" key={ticket.id}><div className={`purchase-thumb tone-${index ? "rose" : "cream"}`}>LF</div><div className="purchase-main"><small>{ticket.ticket_number}</small><h3>{ticket.product_name_snapshot}</h3><p>{ticket.variant_name_snapshot ?? "Producto especial"}</p></div><div className="purchase-state"><Badge tone={ticket.logistics_status === "DELIVERED" ? "success" : "rose"}>{logistics[ticket.logistics_status] ?? ticket.logistics_status}</Badge><strong>{ticket.financial_status === "PAID" ? "Pagado" : `${money(Math.max(ticket.agreed_total_cents - ticket.paid_principal_cents, 0))} pendiente`}</strong></div></Card>)}</div> : <EmptyState title="Aún no tienes compras activas" description="Cuando tengas un pedido, podrás seguir aquí cada paso." href="/catalogo" action="Ver catálogo"/>}</div><Card className="account-side-card"><p className="micro-label">PROGRESO DEL PLAN</p><h2>{activePlan ? "Ya falta poco." : "Sin plan activo."}</h2><div className="progress-ring" style={{ background: `conic-gradient(var(--rose) ${progress}%, var(--cream) 0)` }}><span>{progress}<small>%</small></span></div><p>{activePlan ? `Has completado ${paidInstallments} de ${planInstallments.length} pagos de tu plan.` : "No tienes pagos semanales pendientes."}</p><div className="mini-progress"><span style={{ width: `${progress}%` }}/></div><Button href="/cuenta/pagos" variant="secondary" fullWidth>Ver mis pagos</Button></Card></section>{tickets.length > 0 && <section className="proof-section"><Card className="proof-card"><div className="section-heading"><div><p className="micro-label">COMPROBANTES</p><h2>Reportar un pago</h2></div></div><PaymentProofForm tickets={tickets.map(({ id, ticket_number }) => ({ id, ticket_number }))}/></Card></section>}</main>;
}
