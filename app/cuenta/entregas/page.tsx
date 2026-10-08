import Link from "next/link";
import { Icon } from "../../../components/account/AccountIcons";
import { AppointmentWhen, LineSummary, Notice, ProductThumb, SectionHead } from "../../../components/account/AccountUi";
import { CancelAppointment } from "../../../components/account/CancelAppointment";
import { ScheduleDelivery, type SchedulerPoint, type SchedulerTicket } from "../../../components/account/ScheduleDelivery";
import { EmptyState } from "../../../components/ui/EmptyState";
import { CLIENT_CHANGE_RULE, PICKUP_REMINDER, formatDayLong, formatDayShort, formatTimeOnly, moneyText, statusPhrase } from "../../../lib/account-view";
import { getAccountOverview } from "../../../lib/supabase/account";
import { CLIENT_BOOKING_MIGRATION, POLICY_DELIVERY_POINTS, getDeliveryPoints, isClientBookingAvailable, type DeliveryPoint } from "../../../lib/supabase/account-delivery";

export const dynamic = "force-dynamic";

/** "10:00 a 12:00" windows of one day (one per published availability). */
function windows(day: DeliveryPoint["days"][number]) {
  const byAvailability = new Map<string, { first: string; last: string; free: number }>();
  for (const slot of day.slots) {
    const w = byAvailability.get(slot.availabilityId) ?? { first: slot.startsAt, last: slot.startsAt, free: 0 };
    if (slot.startsAt < w.first) w.first = slot.startsAt;
    if (slot.startsAt > w.last) w.last = slot.startsAt;
    if (slot.free) w.free += 1;
    byAvailability.set(slot.availabilityId, w);
  }
  return [...byAvailability.values()].sort((a, b) => a.first.localeCompare(b.first)).map((w) => ({ text: `${formatTimeOnly(w.first)} a ${formatTimeOnly(new Date(new Date(w.last).getTime() + 600000).toISOString())}`, free: w.free }));
}

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ cambiar?: string }> }) {
  const { cambiar } = await searchParams;
  const [data, bookingAvailable, delivery] = await Promise.all([
    getAccountOverview(),
    isClientBookingAvailable(),
    getDeliveryPoints().catch((error) => { console.error("[cuenta/entregas]", error); return { points: [] as DeliveryPoint[], noticeDays: 1 }; }),
  ]);
  const overview = data.overview;
  if (!overview) return <main className="account-content acc-content"><EmptyState title="Tu perfil aún no está listo" description="Escríbenos para revisar tu cuenta." href="/contacto" action="Contactar" /></main>;

  const lines = overview.purchases.flatMap((p) => p.lines);
  const toReschedule = cambiar ? overview.appointments.find((a) => a.key === cambiar && a.canChange) ?? null : null;
  const schedulerLines = toReschedule ? lines.filter((l) => l.ticketId && toReschedule.ticketIds.includes(l.ticketId)) : overview.schedulable;
  const tickets: SchedulerTicket[] = schedulerLines.map((l) => ({ id: l.ticketId!, name: l.name, detail: [l.variant, l.ticketNumber].filter(Boolean).join(" · "), imageUrl: l.imageUrl, balanceText: l.balanceCents > 0 ? `saldo ${moneyText(l.balanceCents)} al entregar` : null }));
  const points: SchedulerPoint[] = delivery.points.map((p) => ({ id: p.id, name: p.name, address: p.address, mapUrl: p.mapUrl, days: p.days.map((d) => ({ date: d.date, label: formatDayShort(`${d.date}`), slots: d.slots.map((s) => ({ ...s, timeLabel: formatTimeOnly(s.startsAt) })) })) }));
  const pointsWithDays = delivery.points.filter((p) => p.days.some((d) => d.slots.some((s) => s.free)));
  const byMessage = lines.filter((l) => l.scheduleByMessage);
  const coming = lines.filter((l) => ["WAITING_TO_ORDER", "READY_TO_ORDER", "ORDERED", "IN_TRANSIT", "RECEIVED_LA_PAZ"].includes(l.status));

  return <main className="account-content acc-content">
    <header className="acc-page-head"><h1>Entregas</h1><p>Agenda tu entrega, revisa tus citas y conoce dónde entregamos.</p></header>

    {overview.appointments.length > 0 && <section className="acc-section">
      <SectionHead eyebrow="Mis citas" title={overview.appointments.length === 1 ? "Tu cita de entrega" : "Tus citas de entrega"} />
      <div className="acc-stack">{overview.appointments.map((a) => <article key={a.key} className="acc-card acc-pad acc-appointment-card">
        <div className="acc-appointment"><Icon name="calendar" size={24} /><div><strong><AppointmentWhen startsAt={a.startsAt} endsAt={a.endsAt} /></strong><span>{a.locationName} · {a.deliveryType === "DIDI" ? "Envío por DiDi" : "Recoges en el punto"}</span>{a.locationAddress && <a className="acc-inline-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.locationName}, ${a.locationAddress}, La Paz, B.C.S.`)}`} target="_blank" rel="noreferrer">{a.locationAddress} · Ver mapa</a>}</div></div>
        <ul className="acc-mini-lines">{a.lines.map((l, i) => <li key={`${l.ticketNumber}-${i}`}><ProductThumb src={l.imageUrl} name={l.name} size="sm" /><span>{l.name}{l.balanceCents > 0 ? <small>Saldo a pagar al recibir: {moneyText(l.balanceCents)}</small> : <small>Pagado</small>}</span></li>)}</ul>
        {a.canChange && bookingAvailable
          ? <div className="acc-appointment-actions"><Link className="button button-secondary acc-btn" href={`/cuenta/entregas?cambiar=${a.key}#agendar`}>Cambiar horario</Link><CancelAppointment bookingIds={a.bookingIds} /></div>
          : <p className="acc-muted">{a.canChange ? "Para cambiarla escríbenos." : "Tu cita es hoy: si necesitas cambiarla, escríbenos."} <Link className="acc-inline-link" href="/contacto">Contactar</Link></p>}
        <p className="acc-muted">{CLIENT_CHANGE_RULE}</p>
      </article>)}</div>
    </section>}

    <section className="acc-section" id="agendar">
      <SectionHead eyebrow={toReschedule ? "Cambiar horario" : "Agendar"} title={toReschedule ? "Elige tu nuevo horario" : "Agendar mi entrega"} />
      {!bookingAvailable
        ? <Notice tone="warning"><strong>El agendado en línea se activa muy pronto.</strong><p>Mientras tanto, escríbenos para elegir día y hora. <Link className="acc-inline-link" href="/contacto">Contactar</Link></p><small className="acc-tech">Pendiente aplicar {CLIENT_BOOKING_MIGRATION}.</small></Notice>
        : !tickets.length
          ? <div className="acc-card acc-pad acc-muted">{coming.length ? "Cuando uno de tus pedidos esté listo en La Paz, aquí podrás elegir lugar, día y hora." : "No tienes pedidos listos para entrega por ahora."}</div>
          : !points.length
            ? <Notice>Tu pedido está listo, pero aún no hay horarios publicados. Te avisaremos en cuanto los haya, o escríbenos para coordinar. <Link className="acc-inline-link" href="/contacto">Contactar</Link></Notice>
            : <div className="acc-card acc-pad"><ScheduleDelivery tickets={tickets} points={points} reschedule={Boolean(toReschedule)} /><p className="acc-muted">{PICKUP_REMINDER} Agenda con al menos {delivery.noticeDays} día(s) de anticipación.</p></div>}
    </section>

    {byMessage.length > 0 && <section className="acc-section">
      <SectionHead eyebrow="Compras en tienda" title="Listas para coordinar" />
      <div className="acc-card acc-pad acc-stack-sm">{byMessage.map((l) => <LineSummary key={l.key} line={l} />)}<p className="acc-muted">Estas compras se coordinan por mensaje.</p><Link className="button button-primary acc-btn acc-btn-full" href="/contacto"><Icon name="send" size={18} />Coordinar mi entrega</Link></div>
    </section>}

    {coming.length > 0 && <section className="acc-section">
      <SectionHead eyebrow="En camino" title="Lo que viene" href="/cuenta/compras" linkText="Ver compras" />
      <ul className="acc-card acc-pad acc-coming">{coming.map((l) => <li key={l.key}><LineSummary line={l} /><p className="acc-muted">{statusPhrase(l)}</p></li>)}</ul>
    </section>}

    <section className="acc-section" id="puntos">
      <SectionHead eyebrow="¿Dónde entregan?" title="Puntos de entrega" />
      {delivery.points.length ? <div className="acc-stack">{delivery.points.map((p) => <article key={p.id} className="acc-card acc-pad acc-point">
        <div className="acc-point-head"><Icon name="pin" size={22} /><div><strong>{p.name}</strong><span>{p.address}</span></div></div>
        <a className="button button-secondary acc-btn" href={p.mapUrl} target="_blank" rel="noreferrer"><Icon name="map" size={18} />Ver en el mapa</a>
        {p.days.length ? <ul className="acc-point-days">{p.days.slice(0, 6).map((d) => <li key={d.date}><b>{formatDayLong(d.date)}</b>{windows(d).map((w) => <span key={w.text}>{w.text}{w.free === 0 ? " · lleno" : ""}</span>)}</li>)}</ul>
          : <p className="acc-muted">Aún no hay horarios publicados aquí. Te avisaremos cuando los haya.</p>}
        {(p.pickup || p.didi) && <p className="acc-muted">{[p.pickup && "Recoger", p.didi && "Envío por DiDi"].filter(Boolean).join(" · ")}</p>}
      </article>)}{!pointsWithDays.length && <p className="acc-muted">Por ahora no hay horarios libres. Te avisaremos cuando se publiquen nuevos.</p>}</div>
        : <div className="acc-card acc-pad">
          <p className="acc-muted">Estos son nuestros puntos habituales en La Paz. Confirma día, horario y punto por mensaje antes de acudir; te avisaremos aquí cuando haya horarios para agendar en línea.</p>
          <ul className="acc-policy-points">{POLICY_DELIVERY_POINTS.map((p) => <li key={p.name}><Icon name="pin" size={18} /><span><strong>{p.name}</strong><small>{p.hours}</small></span></li>)}</ul>
          <p className="acc-muted">Envíos nacionales por Estafeta y entregas locales por DiDi con costo aparte. <Link className="acc-inline-link" href="/como-comprar#entregas">Ver políticas de entrega</Link></p>
        </div>}
    </section>
  </main>;
}
