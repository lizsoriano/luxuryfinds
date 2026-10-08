import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { ConfirmAction } from "../../../../components/admin/ConfirmAction";
import { formatDateTime, formatMoney, LOGISTICS_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "../../../../lib/format";
import { STAGE_LABELS, STAGE_TONES } from "../../../../lib/sales-feed";
import { getSalesRecord, salesHistory, type HistoryEvent } from "../../../../lib/supabase/sales";
import { getTrackingLink } from "../../../../lib/supabase/sales-tracking";
import { getPurchaseLinksForTickets } from "../../../../lib/supabase/admin-purchases";
import { hasReservationTickets } from "../../../../lib/supabase/incoming-reservations";
import { cancelOrderAction, confirmOrderAction } from "../../pedidos/actions";
import { CancelSaleDialog } from "../../balance/CancelSaleDialog";
import { PrintSale, SalesNotes, SalesTracking } from "../SalesControls";

export const dynamic = "force-dynamic";
export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let record;
  try { record = await getSalesRecord(id); }
  catch (error) { return <main className="admin-content"><PageHeader title="Detalle de la venta" /><Card className="admin-panel"><p className="form-message form-error" role="alert">No pudimos cargar esta venta: {error instanceof Error ? error.message : "Intenta nuevamente."}</p><Link href="/admin/vender">Volver a Ventas</Link></Card></main>; }
  if (!record) notFound();
  const r = record;
  const [historyResult, trackingResult, purchaseLinks, reservation] = await Promise.all([
    salesHistory(r).then(events => ({ events, failed: false })).catch(() => ({ events: [] as HistoryEvent[], failed: true })),
    getTrackingLink(id).then(link => ({ ...link, failed: false })).catch(() => ({ token: null, unavailable: false, failed: true })),
    getPurchaseLinksForTickets(r.tickets.map(t => t.id)),
    hasReservationTickets(r.tickets.map(t => t.id)),
  ]);
  const purchase = [...purchaseLinks.values()][0];
  const units = r.lines.reduce((n,i) => n + i.quantity, 0);
  const events = [...historyResult.events,
    ...r.payments.map(p => ({ id: `payment-${p.id}`, date: p.effective_paid_at, label: `${formatMoney(Number(p.amount_cents))} recibidos · ${PAYMENT_METHOD_LABELS[p.method] ?? p.method}` })),
    ...r.refunds.map(f => ({ id: `refund-${f.id}`, date: f.refunded_at, label: `${formatMoney(Number(f.amount_cents))} reembolsados · ${f.method}` })),
  ].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return <main className="admin-content sales-page sales-detail">
    <Link className="sales-back sales-no-print" href="/admin/vender">← Volver a Ventas</Link>
    <PageHeader title={<>#{r.index.reference} <Badge tone={STAGE_TONES[r.index.stage]}>{STAGE_LABELS[r.index.stage]}</Badge></>} description={`Detalle de la venta · ${formatDateTime(r.index.occurred_at)} · ${r.channel}`} action={<div className="sales-control-row sales-no-print">
      {r.index.kind === "SALE" && r.status !== "CANCELLED" && <CancelSaleDialog saleId={r.index.id} reference={r.index.reference} />}
      {r.index.kind === "ORDER" && r.status === "DRAFT" && <ConfirmAction action={confirmOrderAction} fields={{ id: r.index.id }} triggerLabel="Confirmar pedido" title="Confirmar pedido" description="Se generarán los tickets, el plan de pagos solicitado y los movimientos de inventario correspondientes." confirmLabel="Confirmar pedido" variant="primary" />}
      {r.index.kind === "ORDER" && ["DRAFT", "CONFIRMED"].includes(r.status) && !purchase && !reservation && <ConfirmAction action={cancelOrderAction} fields={{ id: r.index.id }} triggerLabel="Cancelar pedido" title="Cancelar pedido" description="El pedido se cancelará y se liberará el inventario correspondiente mediante las reglas actuales." variant="danger" />}
      {purchase && <Link href={`/admin/compras/${purchase.purchaseId}`}>Gestionar compra {purchase.purchaseNumber}</Link>}{reservation && <Link href="/admin/apartados">Gestionar apartado</Link>}
    </div>} />
    <div className="sales-detail-grid"><div className="sales-main-column">
      <Card className="admin-panel"><div className="section-heading"><h2>{units} {units === 1 ? "unidad" : "unidades"}</h2><Badge tone={STAGE_TONES[r.index.stage]}>{STAGE_LABELS[r.index.stage]}</Badge></div>
        <div className="sales-lines">{r.lines.length ? r.lines.map(i => <div className="sales-line" key={i.id}>{i.image ? <img src={i.image} alt="" width={64} height={64} /> : <div className="sales-image-placeholder" aria-hidden="true">◇</div>}<div>{i.productId ? <Link className="sales-link" href={`/admin/productos/${i.productId}`}>{i.name}</Link> : <strong>{i.name}</strong>}{i.variant && <p className="admin-hint">{i.variant}</p>}<p className="admin-hint"><span className="sales-quantity">{i.quantity}</span> × {formatMoney(i.unitCents)}</p></div><strong>{formatMoney(i.totalCents)}</strong></div>) : <p>Venta libre de mostrador.</p>}</div>
        <div className="sales-delivery"><span>{r.index.kind === "SALE" ? "Entrega de mostrador" : "Entrega según la agenda del pedido"}</span><PrintSale /></div>
        {r.tickets.length > 0 && <details><summary className="sales-text-button">Estados por producto</summary><ul className="sales-ticket-states">{r.tickets.map(t => <li key={t.id}>{t.product_name_snapshot} · {LOGISTICS_STATUS_LABELS[t.logistics_status] ?? t.logistics_status}</li>)}</ul><Link className="sales-link sales-no-print" href={`/admin/pedidos/${r.index.id}`}>Ver tickets y plan de pagos</Link></details>}
      </Card>
      <Card className="admin-panel"><div className="section-heading"><h2>Pago</h2><div className="sales-payment">{r.payment.badges.map(b => <Badge key={b.label} tone={b.tone}>{b.label}</Badge>)}</div></div>
        <dl className="sales-totals"><div><dt>Subtotal ({units} unidades)</dt><dd>{formatMoney(r.subtotalCents)}</dd></div>{r.discountCents > 0 && <div><dt>Descuento</dt><dd>−{formatMoney(r.discountCents)}</dd></div>}<div><dt>Envío</dt><dd>No registrado en esta venta</dd></div><div className="sales-total"><dt>Total</dt><dd>{formatMoney(r.totalCents)}</dd></div>{r.refundCents > 0 && <div className="sales-refund"><dt>Reembolso</dt><dd>−{formatMoney(r.refundCents)}</dd></div>}<div><dt>Total pagado por el cliente</dt><dd>{formatMoney(r.paidCents - r.refundCents)}</dd></div></dl>
        <p className="admin-hint">{r.payment.methodText}</p>{r.payments.length > 0 && <details><summary className="sales-text-button">Detalles de pagos</summary><ul>{r.payments.map(p => <li key={p.id}>{formatDateTime(p.effective_paid_at)} · {formatMoney(Number(p.amount_cents))} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}</li>)}</ul></details>}
        {r.index.kind === "SALE" && r.status === "CANCELLED" && <p className="admin-hint">La cancelación devuelve inventario. Esta venta no registra un reembolso monetario.</p>}
      </Card>
      <Card className="admin-panel"><SalesNotes target={id} notes={r.notes} /></Card>
    </div><aside className="sales-side-column"><h2 className="sales-more-heading">Más información</h2>
      <Card className="admin-panel"><h2>Datos del cliente</h2>{r.client ? <><Link className="sales-link" href={`/admin/clientes/${r.client.id}`}>{r.client.first_name} {r.client.last_name}</Link><p>{r.client.email || "Sin correo registrado"}</p><p>{r.client.phone}</p><Link className="sales-link sales-no-print" href={`/admin/clientes/${r.client.id}`}>Editar información</Link><hr /><h2>Dirección de envío y facturación</h2><p>{r.client.address || "Sin dirección registrada"}</p><p className="admin-hint">Dirección actual de la clienta. No hay una dirección de facturación registrada para esta venta.</p></> : <p className="admin-hint">Venta sin cliente registrado.</p>}</Card>
      <Card className="admin-panel"><h2>Historial</h2>{historyResult.failed && <p className="form-message" role="status">No pudimos cargar los cambios de estado. Los pagos registrados se muestran abajo.</p>}<ol className="sales-history">{events.map(e => <li key={e.id}><span>{e.label}</span><time dateTime={e.date}>{formatDateTime(e.date)}</time></li>)}</ol></Card>
      <Card className="admin-panel">{trackingResult.failed ? <p className="form-message" role="alert">No pudimos consultar el enlace de seguimiento. Actualiza esta página.</p> : <SalesTracking target={id} token={trackingResult.token} unavailable={trackingResult.unavailable} />}</Card>
    </aside></div>
  </main>;
}
