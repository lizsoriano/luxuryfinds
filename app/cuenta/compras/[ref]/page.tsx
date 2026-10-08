import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../components/account/AccountIcons";
import { AppointmentWhen, MoneyRow, ProductThumb, StatusBadge, TrackProgress } from "../../../../components/account/AccountUi";
import { Badge } from "../../../../components/ui/Badge";
import { CLIENT_CHANGE_RULE, PICKUP_REMINDER, formatDateShort, formatDayLong, moneyText, statusLabel } from "../../../../lib/account-view";
import { getAccountOverview } from "../../../../lib/supabase/account";
import { mapUrl } from "../../../../lib/supabase/account-delivery";

export const dynamic = "force-dynamic";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const data = await getAccountOverview();
  // Only purchases built from HER scoped reads can be found: another client's id simply is not there.
  const purchase = data.overview?.purchases.find((p) => p.key === ref);
  if (!purchase || !data.overview) notFound();

  const ticketIds = new Set(purchase.lines.flatMap((l) => l.ticketId ? [l.ticketId] : []));
  const plans = data.overview.plans.filter((p) => ticketIds.has(p.ticketId));
  const history = [
    { id: "created", date: purchase.createdAt, text: purchase.kind === "SALE" ? "Compra registrada en tienda" : "Pedido registrado" },
    ...purchase.payments.map((p) => ({ id: `pay-${p.id}`, date: p.paidAt, text: `Pago recibido: ${moneyText(p.amountCents)} (${p.methodLabel})` })),
    ...data.overview.notifications.filter((n) => n.ticket_id && ticketIds.has(n.ticket_id)).map((n) => ({ id: `n-${n.id}`, date: n.created_at, text: n.title })),
    ...purchase.lines.filter((l) => l.source === "SALE_ITEM" && l.status !== "DELIVERED" && l.statusUpdatedAt).map((l) => ({ id: `st-${l.key}`, date: l.statusUpdatedAt!, text: `${l.name}: ${statusLabel(l.status)}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const owedTicket = purchase.lines.find((l) => l.balanceCents > 0 && l.ticketId)?.ticketId;

  return <main className="account-content acc-content">
    <Link className="acc-back" href="/cuenta/compras"><Icon name="back" size={18} />Mis compras</Link>
    <header className="acc-page-head acc-detail-head">
      <p className="acc-eyebrow">{purchase.channel} · {formatDateShort(purchase.createdAt)}</p>
      <h1>{purchase.reference}</h1>
    </header>

    <section className="acc-section">
      <h2 className="acc-h2">¿Dónde está?</h2>
      <div className="acc-stack">{purchase.lines.map((line) => <article key={line.key} className="acc-card acc-pad acc-where">
        <div className="acc-where-head">
          <ProductThumb src={line.imageUrl} name={line.name} size="lg" />
          <div><strong>{line.name}</strong><span>{[line.variant, `${line.quantity} ${line.unitLabel ?? (line.quantity === 1 ? "pieza" : "piezas")}`, line.ticketNumber].filter(Boolean).join(" · ")}</span><StatusBadge line={line} /></div>
        </div>
        <TrackProgress line={line} />
        {line.eta && <p className="acc-muted"><Icon name="clock" size={15} /> Llegada estimada a La Paz: {formatDayLong(line.eta)}</p>}
        {line.booking?.status === "BOOKED" && line.booking.startsAt && <div className="acc-booking-box">
          <Icon name="calendar" size={20} />
          <div><strong>{line.booking.pending ? "Solicitud enviada · esperando confirmación" : "Cita confirmada · puedes pasar"}</strong>
            <strong><AppointmentWhen startsAt={line.booking.startsAt} endsAt={line.booking.endsAt ?? line.booking.startsAt} /></strong>
            <span>{line.booking.locationName} · {line.booking.deliveryType === "DIDI" ? "Envío por DiDi" : "Recoges en el punto"}</span>
            {line.booking.locationAddress && <a className="acc-inline-link" href={mapUrl(line.booking.locationName ?? "", line.booking.locationAddress)} target="_blank" rel="noreferrer">{line.booking.locationAddress} · Ver mapa</a>}
            <small>{line.booking.pending ? "Te avisamos cuando la confirmemos; solo entonces puedes pasar." : CLIENT_CHANGE_RULE} <Link className="acc-inline-link" href="/cuenta/entregas">Cambiar o cancelar</Link></small></div>
        </div>}
        {line.canSchedule && <><Link className="button button-primary acc-btn acc-btn-full" href="/cuenta/entregas#agendar"><Icon name="calendar" size={18} />{line.requestState === "REJECTED" ? "Elegir otro horario" : "Agendar mi entrega"}</Link><p className="acc-muted">{PICKUP_REMINDER}</p></>}
        {line.scheduleByMessage && <><Link className="button button-primary acc-btn acc-btn-full" href="/contacto"><Icon name="send" size={18} />Coordinar mi entrega</Link><p className="acc-muted">{PICKUP_REMINDER}</p></>}
        {line.reservation?.status === "ACTIVE" && <p className="acc-muted"><Icon name="clock" size={15} /> Apartado: liquida antes del {formatDayLong(line.reservation.expiresAt)}.</p>}
      </article>)}</div>
    </section>

    <section className="acc-section">
      <h2 className="acc-h2">Recibo</h2>
      <div className="acc-card acc-pad acc-receipt">
        <ul>{purchase.lines.map((line) => <li key={line.key}><span>{line.name}{line.quantity !== 1 ? ` × ${line.quantity}` : ""}{line.planId ? <small> (precio con plan de pagos)</small> : null}</span><b>{line.status === "CANCELLED" || line.status === "CANCELLED_INCIDENT" ? <s>{moneyText(line.totalCents)}</s> : moneyText(line.totalCents)}</b></li>)}</ul>
        {(purchase.discountCents > 0 || purchase.state === "CANCELLED") && <dl>
          {purchase.discountCents > 0 && <><dt>Subtotal</dt><dd>{moneyText(purchase.subtotalCents)}</dd><dt>Descuento</dt><dd>−{moneyText(purchase.discountCents)}</dd></>}
          <dt>{purchase.state === "CANCELLED" ? "Compra cancelada" : "Total"}</dt><dd>{moneyText(purchase.state === "CANCELLED" ? 0 : purchase.totalCents)}</dd>
          {purchase.state === "CANCELLED" && purchase.paidCents > 0 && <><dt>Pagos registrados</dt><dd>{moneyText(purchase.paidCents)}</dd></>}
        </dl>}
        {purchase.state !== "CANCELLED" && <MoneyRow total={purchase.totalCents} paid={purchase.paidCents} balance={purchase.balanceCents} />}
        {purchase.balanceCents > 0 && <Link className="button button-secondary acc-btn acc-btn-full" href={`/cuenta/pagos?ticket=${owedTicket ?? ""}#subir`}><Icon name="wallet" size={18} />Pagar / subir comprobante</Link>}
      </div>
    </section>

    <section className="acc-section">
      <h2 className="acc-h2">Pagos recibidos</h2>
      <div className="acc-card acc-pad">{purchase.payments.length
        ? <ul className="acc-rows">{purchase.payments.map((p) => <li key={p.id}><span>{formatDateShort(p.paidAt)} · {purchase.kind === "SALE" ? `Pagado en tienda (${p.methodLabel})` : p.methodLabel}</span><b>{moneyText(p.amountCents)}</b></li>)}</ul>
        : <p className="acc-muted">Aún no hay pagos registrados en esta compra.</p>}
        {purchase.proofs.length > 0 && <><h3 className="acc-h3">Comprobantes que enviaste</h3><ul className="acc-rows">{purchase.proofs.map((p) => <li key={p.id}><span>{formatDateShort(p.uploadedAt)} · {moneyText(p.amountCents)}{p.rejectionReason ? <small>Motivo: {p.rejectionReason}</small> : null}</span><Badge tone={p.tone}>{p.statusLabel}</Badge></li>)}</ul></>}
      </div>
    </section>

    {plans.map((plan) => <section className="acc-section" key={plan.id}>
      <h2 className="acc-h2">{plan.modeLabel}</h2>
      <div className="acc-card acc-pad"><ul className="acc-rows">{plan.installments.map((i) => <li key={i.id}><span>Pago {i.number} · {formatDateShort(i.dueAt)}</span><span className="acc-row-end"><b>{moneyText(i.amountCents)}</b><Badge tone={i.status === "PAID" ? "success" : i.status === "OVERDUE" ? "danger" : "warning"}>{i.status === "PAID" ? "Pagado" : i.status === "OVERDUE" ? "Vencido" : i.status === "PARTIAL" ? "Parcial" : "Pendiente"}</Badge></span></li>)}</ul></div>
    </section>)}

    <section className="acc-section">
      <h2 className="acc-h2">Historial</h2>
      <ol className="acc-card acc-pad acc-history">{history.map((h) => <li key={h.id}><time>{formatDateShort(h.date)}</time><span>{h.text}</span></li>)}</ol>
    </section>
  </main>;
}
