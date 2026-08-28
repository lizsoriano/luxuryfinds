import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import { getAdminDashboardData } from "../../lib/supabase/admin-data";

export const dynamic = "force-dynamic";

const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);
const method: Record<string, string> = { TRANSFER: "Transferencia", CASH: "Efectivo", PAYMENT_LINK: "Link de pago" };

function relation<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? (value[0] ?? null) : value; }

export default async function AdminPage() {
  let data;
  try { data = await getAdminDashboardData(); }
  catch { return <main className="admin-content"><EmptyState title="No pudimos cargar el panel" description="Verifica la conexión de Supabase e intenta de nuevo."/></main>; }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());
  const dueToday = data.installments.filter((item) => item.due_at.startsWith(today));
  const dueCents = dueToday.reduce((sum, item) => sum + item.amount_cents - item.paid_cents, 0);
  const ready = data.tickets.filter((item) => item.logistics_status === "READY_TO_ORDER");
  const todayDeliveries = data.deliveries.filter((item) => {
    const slot = relation(item.delivery_slots as { starts_at: string } | Array<{ starts_at: string }> | null);
    return item.status === "BOOKED" && slot?.starts_at.startsWith(today);
  });
  const pendingTotal = data.proofs.reduce((sum, proof) => sum + proof.reported_amount_cents, 0);
  const logistics = [["Listos para ordenar", "READY_TO_ORDER", "rose"], ["Ordenados", "ORDERED", "cream"], ["En camino", "IN_TRANSIT", "beige"], ["Recibidos en La Paz", "RECEIVED_LA_PAZ", "success"]] as const;

  return <main className="admin-content"><PageHeader eyebrow="RESUMEN OPERATIVO" title="Buenos días." description="Esto es lo más importante para Luxury Finds hoy." action={<Button size="small">Nueva compra <span aria-hidden>＋</span></Button>}/><section className="admin-stats"><StatCard label="POR VALIDAR" value={String(data.proofs.length)} note={`${money(pendingTotal)} reportados`} tone="rose"/><StatCard label="PAGOS ESPERADOS HOY" value={String(dueToday.length)} note={`${money(dueCents)} por cobrar`}/><StatCard label="LISTOS PARA ORDENAR" value={String(ready.length)} note="Requieren atención" tone="warning"/><StatCard label="ENTREGAS DE HOY" value={String(todayDeliveries.length)} note={`${todayDeliveries.filter((item) => item.delivery_type === "DIDI").length} envíos por DiDi`}/></section><section className="admin-dashboard-grid"><Card className="admin-priority"><div className="section-heading"><div><p className="micro-label">PRIORIDAD DE HOY</p><h2>Pagos por validar</h2></div><Button variant="secondary" size="small">Ver todos</Button></div>{data.proofs.length ? <div className="admin-table" role="table" aria-label="Pagos por validar"><div className="admin-table-head" role="row"><span>CLIENTA</span><span>TICKET</span><span>MÉTODO</span><span>MONTO</span><span>ESTADO</span></div>{data.proofs.slice(0, 5).map((proof) => { const ticket = relation(proof.tickets as unknown as { ticket_number: string; clients: { first_name: string; last_name: string } | Array<{ first_name: string; last_name: string }> | null } | Array<{ ticket_number: string; clients: { first_name: string; last_name: string } | Array<{ first_name: string; last_name: string }> | null }> | null); const client = relation(ticket?.clients ?? null); const name = client ? `${client.first_name} ${client.last_name}` : "Cliente"; return <div className="admin-table-row" role="row" key={proof.id}><span><i>{name.split(" ").map((part) => part[0]).slice(0,2).join("")}</i><strong>{name}</strong></span><span>{ticket?.ticket_number ?? "—"}</span><span>{method[proof.payment_method] ?? proof.payment_method}</span><span>{money(proof.reported_amount_cents)}</span><span><Badge tone="warning">Pendiente</Badge></span></div>; })}</div> : <EmptyState title="Todo está al día" description="No hay comprobantes pendientes de validación."/>}</Card><Card className="admin-activity"><div className="section-heading"><div><p className="micro-label">ACTIVIDAD</p><h2>Lo más reciente</h2></div></div>{data.activity.length ? <div className="activity-list">{data.activity.map((item,index)=><div key={item.id}><span className={`activity-icon activity-${index}`}>{index+1}</span><p><strong>{item.action}</strong><small>{item.entity_type} · {item.entity_id}</small></p><time>{new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mazatlan" }).format(new Date(item.created_at))}</time></div>)}</div> : <EmptyState title="Sin actividad reciente" description="La bitácora aparecerá aquí."/>}<Button variant="secondary" fullWidth size="small">Ver bitácora</Button></Card></section><section className="logistics-section"><div className="section-heading"><div><p className="micro-label">LOGÍSTICA</p><h2>Estado de productos</h2></div></div><div className="logistics-grid">{logistics.map(([label,status,tone])=><Card className={`logistics-card logistics-${tone}`} key={status}><span>{data.tickets.filter((ticket) => ticket.logistics_status === status).length}</span><p>{label}</p><small>Ver productos →</small></Card>)}</div></section></main>;
}
