import Link from "next/link";
import { Badge } from "../ui/Badge";
import { Icon } from "./AccountIcons";
import {
  TRACK_STEPS, formatDateShort, formatDayLong, formatTimeOnly, moneyText, statusLabel, statusPhrase, statusTone, trackIndex,
  type AccountAction, type AccountLine, type AccountMoney, type AccountPurchase,
} from "../../lib/account-view";

// Server-rendered building blocks of the client's panel (/cuenta).

export function ProductThumb({ src, name, size = "md" }: { src: string | null; name: string; size?: "sm" | "md" | "lg" }) {
  if (src) {
    // Catalogue images come from the public Supabase bucket (any size/host), so a plain <img> is used, like the rest of the app.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`acc-thumb acc-thumb-${size}`} src={src} alt={name} loading="lazy" decoding="async" />;
  }
  return <span className={`acc-thumb acc-thumb-${size} acc-thumb-empty`} role="img" aria-label={`${name} (sin foto)`}><Icon name="bag" size={size === "lg" ? 34 : size === "sm" ? 18 : 26} /></span>;
}

export function StatusBadge({ line }: { line: Pick<AccountLine, "status" | "hasIncident"> }) {
  const text = line.hasIncident && !["DELIVERED", "CANCELLED", "CANCELLED_INCIDENT"].includes(line.status) ? "Con un detalle" : statusLabel(line.status);
  return <Badge tone={statusTone(line)}>{text}</Badge>;
}

/** Where the item is now: five business stages, the current one highlighted. */
export function TrackProgress({ line, showPhrase = true }: { line: AccountLine; showPhrase?: boolean }) {
  const index = trackIndex(line.status);
  if (index === null) {
    return showPhrase ? <p className="acc-track-note is-cancelled"><Icon name="alert" size={16} />{statusPhrase(line)}</p> : null;
  }
  const scheduled = line.status === "DELIVERY_SCHEDULED";
  return (
    <div className="acc-track">
      <ol className="acc-steps" aria-label={`Estado: ${statusLabel(line.status)}`}>
        {TRACK_STEPS.map((step, i) => {
          const state = i < index ? "done" : i === index ? "current" : "todo";
          const label = i === 3 && scheduled ? "Agendada" : step.short;
          return (
            <li key={step.status} className={`is-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="acc-step-dot">{state === "done" || (state === "current" && i === 4) ? <Icon name="check" size={12} /> : null}</span>
              <span className="acc-step-label">{label}</span>
            </li>
          );
        })}
      </ol>
      {showPhrase && (
        <p className={`acc-track-note${line.hasIncident && line.status !== "DELIVERED" ? " is-incident" : ""}`}>
          {line.hasIncident && line.status !== "DELIVERED" && <Icon name="alert" size={16} />}
          <span>
            {statusPhrase(line)}
            {line.statusUpdatedAt && line.status !== "PENDING_CONFIRMATION" && <small> Actualizado el {formatDateShort(line.statusUpdatedAt)}.</small>}
          </span>
        </p>
      )}
    </div>
  );
}

export function LineSummary({ line }: { line: AccountLine }) {
  const qty = line.quantity === 1 && !line.unitLabel ? null : `${line.quantity} ${line.unitLabel ?? (line.quantity === 1 ? "pieza" : "piezas")}`;
  return (
    <div className="acc-line">
      <ProductThumb src={line.imageUrl} name={line.name} />
      <div className="acc-line-text">
        <strong>{line.name}</strong>
        <span>{[line.variant && line.variant !== "Único" ? line.variant : null, qty, line.ticketNumber].filter(Boolean).join(" · ") || "Pieza única"}</span>
        <StatusBadge line={line} />
      </div>
    </div>
  );
}

export function MoneyRow({ total, paid, balance }: { total: number; paid: number; balance: number }) {
  return (
    <dl className="acc-money-row">
      <div><dt>Total</dt><dd>{moneyText(total)}</dd></div>
      <div><dt>Pagado</dt><dd>{moneyText(paid)}</dd></div>
      <div className={balance > 0 ? "is-owed" : "is-clear"}><dt>{balance > 0 ? "Por pagar" : "Saldo"}</dt><dd>{balance > 0 ? moneyText(balance) : <><Icon name="check" size={14} /> Liquidado</>}</dd></div>
    </dl>
  );
}

const STATE_BADGE: Record<AccountPurchase["state"], [string, "rose" | "warning" | "neutral" | "danger"]> = {
  ACTIVE: ["En proceso", "rose"],
  PENDING: ["Por confirmar", "warning"],
  DELIVERED: ["Entregada", "neutral"],
  CANCELLED: ["Cancelada", "danger"],
};

export function PurchaseCard({ purchase, showTrack = true }: { purchase: AccountPurchase; showTrack?: boolean }) {
  const [stateText, stateTone] = STATE_BADGE[purchase.state];
  const schedulable = purchase.lines.some((line) => line.canSchedule);
  const byMessage = purchase.lines.some((line) => line.scheduleByMessage);
  const shown = purchase.lines.slice(0, 4);
  return (
    <article className={`acc-card acc-purchase is-${purchase.state.toLowerCase()}`}>
      <header className="acc-purchase-head">
        <div><strong>{purchase.reference}</strong><span>{purchase.channel} · {formatDateShort(purchase.createdAt)}</span></div>
        <Badge tone={stateTone}>{stateText}</Badge>
      </header>
      <div className="acc-purchase-lines">
        {shown.map((line) => (
          <div key={line.key} className="acc-purchase-line">
            <LineSummary line={line} />
            {showTrack && purchase.state !== "DELIVERED" && purchase.state !== "CANCELLED" && <TrackProgress line={line} />}
          </div>
        ))}
        {purchase.lines.length > shown.length && <p className="acc-more">y {purchase.lines.length - shown.length} producto(s) más</p>}
      </div>
      {purchase.state !== "CANCELLED" && <MoneyRow total={purchase.totalCents} paid={purchase.paidCents} balance={purchase.balanceCents} />}
      <footer className="acc-purchase-actions">
        {schedulable && <Link className="button button-primary acc-btn" href="/cuenta/entregas#agendar"><Icon name="calendar" size={18} />Agendar mi entrega</Link>}
        {byMessage && <Link className="button button-primary acc-btn" href="/contacto"><Icon name="send" size={18} />Coordinar mi entrega</Link>}
        {purchase.balanceCents > 0 && !schedulable && <Link className="button button-secondary acc-btn" href={`/cuenta/pagos?ticket=${purchase.lines.find((l) => l.balanceCents > 0)?.ticketId ?? ""}#subir`}><Icon name="wallet" size={18} />Pagar / subir comprobante</Link>}
        <Link className="acc-link" href={`/cuenta/compras/${purchase.key}`}>Ver detalle y recibo <Icon name="arrow" size={16} /></Link>
      </footer>
    </article>
  );
}

export function ActionCard({ action, primary = false }: { action: AccountAction; primary?: boolean }) {
  const icon = action.tone === "urgent" ? "alert" : action.tone === "ready" ? "calendar" : action.tone === "ok" ? "check" : "clock";
  if (!primary) {
    return (
      <Link className={`acc-action-row is-${action.tone}`} href={action.href}>
        <span className="acc-action-icon"><Icon name={icon} size={18} /></span>
        <span><strong>{action.title}</strong><small>{action.body}</small></span>
        <Icon name="arrow" size={18} className="acc-action-go" />
      </Link>
    );
  }
  return (
    <section className={`acc-action is-${action.tone}`} aria-label="Qué debes hacer ahora">
      <p className="acc-eyebrow">{action.tone === "ok" ? "Tu cuenta" : "Qué debes hacer ahora"}</p>
      <div className="acc-action-body">
        <span className="acc-action-icon"><Icon name={icon} size={22} /></span>
        <div><h2>{action.title}</h2><p>{action.body}</p></div>
      </div>
      <Link className={`button ${action.tone === "ok" ? "button-secondary" : "button-primary"} acc-btn acc-btn-full`} href={action.href}>{action.cta}</Link>
    </section>
  );
}

export function MoneySummary({ money }: { money: AccountMoney }) {
  return (
    <section className="acc-money" aria-label="Resumen de dinero">
      <div><span>Tus compras</span><strong>{moneyText(money.totalCents)}</strong></div>
      <div><span>Pagado</span><strong>{moneyText(money.paidCents)}</strong></div>
      <div className={money.owedCents + money.lateFeesCents > 0 ? "is-owed" : ""}><span>Por pagar</span><strong>{moneyText(money.owedCents + money.lateFeesCents)}</strong></div>
      {money.nextDue && (
        <p className={money.nextDue.overdue ? "is-overdue" : ""}>
          <Icon name="clock" size={15} />
          {money.nextDue.overdue ? "Pago vencido" : "Próximo pago"}: <b>{moneyText(money.nextDue.amountCents)}</b> · {formatDayLong(money.nextDue.dueAt)}
        </p>
      )}
      {money.lateFeesCents > 0 && <p className="is-overdue"><Icon name="alert" size={15} />Incluye {moneyText(money.lateFeesCents)} de cargos por atraso.</p>}
    </section>
  );
}

export function SectionHead({ title, eyebrow, href, linkText, id }: { title: string; eyebrow?: string; href?: string; linkText?: string; id?: string }) {
  return (
    <div className="acc-section-head" id={id}>
      <div>{eyebrow && <p className="acc-eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>
      {href && <Link className="acc-link" href={href}>{linkText ?? "Ver todo"} <Icon name="arrow" size={16} /></Link>}
    </div>
  );
}

export function AppointmentWhen({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  return <>{formatDayLong(startsAt)} · {formatTimeOnly(startsAt)} a {formatTimeOnly(endsAt)}</>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: React.ReactNode }) {
  return <div className={`acc-notice is-${tone}`}><Icon name={tone === "warning" ? "alert" : "clock"} size={18} /><div>{children}</div></div>;
}
