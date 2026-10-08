import Link from "next/link";
import { Icon } from "../../../components/account/AccountIcons";
import { MoneyRow, MoneySummary, ProductThumb, SectionHead } from "../../../components/account/AccountUi";
import { PaymentProofForm } from "../../../components/account/PaymentProofForm";
import { RefundRequestForm } from "../../../components/account/RefundRequestForm";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { formatDateShort, moneyText } from "../../../lib/account-view";
import { getAccountOverview } from "../../../lib/supabase/account";

export const dynamic = "force-dynamic";

const INSTALLMENT: Record<string, [string, "success" | "danger" | "warning" | "neutral"]> = { PAID: ["Pagado", "success"], OVERDUE: ["Vencido", "danger"], PARTIAL: ["Parcial", "warning"], PENDING: ["Pendiente", "neutral"] };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const { ticket } = await searchParams;
  const data = await getAccountOverview();
  const overview = data.overview;
  if (!overview) return <main className="account-content acc-content"><EmptyState title="Tu perfil aún no está listo" description="Escríbenos para revisar tu cuenta." href="/contacto" action="Contactar" /></main>;

  const counted = overview.purchases.filter((p) => p.state === "ACTIVE" || p.state === "DELIVERED");
  const ordered = [...counted].sort((a, b) => Number(b.balanceCents > 0) - Number(a.balanceCents > 0));
  const ticketLines = overview.purchases.filter((p) => p.state !== "CANCELLED").flatMap((p) => p.lines.filter((l) => l.ticketId).map((l) => ({ line: l, purchase: p })));
  const proofTickets = ticketLines.map(({ line }) => ({ id: line.ticketId!, ticket_number: line.ticketNumber ?? "", label: `${line.ticketNumber} · ${line.name}${line.balanceCents > 0 ? ` (debes ${moneyText(line.balanceCents)})` : ""}` }));
  const allPayments = overview.purchases.flatMap((p) => p.payments.map((pay) => ({ ...pay, reference: p.reference }))).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const plans = overview.plans.filter((p) => p.status === "ACTIVE" || p.installments.some((i) => i.status !== "PAID"));

  return <main className="account-content acc-content">
    <header className="acc-page-head"><h1>Pagos</h1><p>Cuánto has pagado, cuánto falta y cómo enviarnos tu comprobante.</p></header>
    {counted.length ? <MoneySummary money={overview.money} /> : <EmptyState title="Aún no tienes pagos" description="Cuando tengas una compra, aquí verás lo pagado y lo pendiente." href="/catalogo" action="Ver catálogo" />}

    {ordered.length > 0 && <section className="acc-section">
      <SectionHead eyebrow="Por compra" title="Tu saldo por compra" />
      <div className="acc-stack">{ordered.map((p) => {
        const pct = p.totalCents ? Math.min(100, Math.round((p.paidCents / p.totalCents) * 100)) : 100;
        const owed = p.lines.find((l) => l.balanceCents > 0 && l.ticketId);
        return <article key={p.key} className="acc-card acc-pad acc-pay-card">
          <div className="acc-pay-head"><ProductThumb src={p.lines[0]?.imageUrl ?? null} name={p.lines[0]?.name ?? p.reference} size="sm" /><div><strong>{p.lines.length === 1 ? p.lines[0].name : `${p.lines.length} productos`}</strong><span>{p.reference} · {formatDateShort(p.createdAt)}</span></div></div>
          <div className="acc-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Pagado ${pct}%`}><span style={{ width: `${pct}%` }} /></div>
          <MoneyRow total={p.totalCents} paid={p.paidCents} balance={p.balanceCents} />
          <div className="acc-pay-actions">{owed && <Link className="button button-primary acc-btn" href={`/cuenta/pagos?ticket=${owed.ticketId}#subir`}>Subir comprobante</Link>}<Link className="acc-link" href={`/cuenta/compras/${p.key}`}>Ver recibo <Icon name="arrow" size={16} /></Link></div>
        </article>;
      })}</div>
    </section>}

    {plans.map((plan) => <section className="acc-section" id="plan" key={plan.id}>
      <SectionHead eyebrow={plan.modeLabel} title={plan.productName} />
      <div className="acc-card acc-pad">
        <p className="acc-muted">{plan.paidCount} de {plan.installments.length} pagos completos · {plan.ticketNumber}</p>
        <div className="acc-bar" role="progressbar" aria-valuenow={plan.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del plan"><span style={{ width: `${plan.progress}%` }} /></div>
        <ul className="acc-rows acc-installments">{plan.installments.map((i) => { const [label, tone] = INSTALLMENT[i.status]; return <li key={i.id} className={`is-${i.status.toLowerCase()}`}><span>Pago {i.number}<small>{formatDateShort(i.dueAt)}</small></span><span className="acc-row-end"><b>{moneyText(i.status === "PAID" ? i.amountCents : i.pendingCents)}</b><Badge tone={tone}>{label}</Badge></span></li>; })}</ul>
        <p className="acc-muted">Cada abono debe reflejarse a más tardar el día indicado; después se aplica un cargo de $100 por semana de atraso.</p>
      </div>
    </section>)}

    <section className="acc-section">
      <SectionHead eyebrow="Cómo pagar" title="Paga y envíanos tu comprobante" />
      <ol className="acc-card acc-pad acc-howto">
        <li><b>1</b><span>Aceptamos transferencia, depósito, efectivo, retiro sin tarjeta y link de pago. <strong>Pídenos los datos o el link</strong> e indica a qué compra corresponde.</span></li>
        <li><b>2</b><span>Haz tu pago dentro de la fecha de tu compra o de tu plan.</span></li>
        <li><b>3</b><span>Sube aquí la foto o PDF del comprobante. Lo revisamos y verás si quedó aprobado.</span></li>
        <li className="acc-howto-cta"><Link className="button button-secondary acc-btn" href="/contacto"><Icon name="send" size={18} />Pedir datos de pago</Link></li>
      </ol>
    </section>

    {proofTickets.length > 0 && <section className="acc-section" id="subir">
      <SectionHead eyebrow="Comprobante" title="Subir comprobante" />
      <div className="acc-card acc-pad"><PaymentProofForm tickets={proofTickets} defaultTicketId={ticket} /></div>
    </section>}

    {overview.proofs.length > 0 && <section className="acc-section" id="comprobantes">
      <SectionHead eyebrow="Revisión" title="Mis comprobantes" />
      <ul className="acc-card acc-pad acc-rows">{overview.proofs.map((p) => { const line = ticketLines.find((t) => t.line.ticketId === p.ticketId)?.line; return <li key={p.id}><span>{moneyText(p.amountCents)} · {p.methodLabel}<small>{line ? `${line.ticketNumber} · ` : ""}Enviado el {formatDateShort(p.uploadedAt)}</small>{p.rejectionReason && <small className="acc-reason">Motivo: {p.rejectionReason}</small>}</span><Badge tone={p.tone}>{p.statusLabel}</Badge></li>; })}</ul>
    </section>}

    {allPayments.length > 0 && <section className="acc-section">
      <SectionHead eyebrow="Historial" title="Pagos recibidos" />
      <ul className="acc-card acc-pad acc-rows">{allPayments.map((p) => <li key={p.id}><span>{formatDateShort(p.paidAt)} · {p.methodLabel}<small>{p.reference}</small></span><b>{moneyText(p.amountCents)}</b></li>)}</ul>
    </section>}

    {proofTickets.length > 0 && <details className="acc-card acc-pad acc-details">
      <summary>¿Necesitas solicitar un reembolso?</summary>
      <p className="acc-muted">Solo aplica en los casos de nuestras políticas (por ejemplo, si no pudimos conseguir tu producto).</p>
      <RefundRequestForm tickets={proofTickets.map(({ id, label }) => ({ id, ticket_number: label }))} />
    </details>}
  </main>;
}
