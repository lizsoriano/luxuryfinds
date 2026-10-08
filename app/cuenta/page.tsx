import Link from "next/link";
import { Icon } from "../../components/account/AccountIcons";
import { ActionCard, AppointmentWhen, MoneySummary, PurchaseCard, SectionHead } from "../../components/account/AccountUi";
import { TelegramCard } from "../../components/account/TelegramCard";
import { EmptyState } from "../../components/ui/EmptyState";
import { formatDateShort, nextActions } from "../../lib/account-view";
import { getAccountOverview } from "../../lib/supabase/account";
import { getTelegramLinkUrl } from "../../lib/telegram/env";

export const dynamic = "force-dynamic";

const TODAY = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Mazatlan" });

export default async function AccountPage() {
  let data;
  try { data = await getAccountOverview(); }
  catch (error) { console.error("[cuenta]", error); return <main className="account-content acc-content"><EmptyState title="No pudimos cargar tu cuenta" description="Intenta de nuevo en unos minutos." /></main>; }
  if (!data.profile || !data.overview) return <main className="account-content acc-content"><EmptyState title="Tu perfil aún no está listo" description="Tu acceso existe, pero falta crear tu perfil de clienta. Escríbenos y lo resolvemos." href="/contacto" action="Contactar" /></main>;

  const { overview, profile } = data;
  const actions = nextActions(overview);
  const active = overview.purchases.filter((p) => p.state === "ACTIVE" || p.state === "PENDING");
  const plan = overview.plans.find((p) => p.status === "ACTIVE");
  const appointment = overview.appointments[0];
  const telegramUrl = data.telegramLinked ? null : getTelegramLinkUrl(data.user.id);
  const hasPurchases = overview.purchases.length > 0;

  return <main className="account-content acc-content">
    <header className="acc-hello">
      <p className="acc-eyebrow">{TODAY.format(new Date())}</p>
      <h1>Hola, {profile.first_name.split(/\s+/)[0]}</h1>
    </header>

    <ActionCard action={actions[0]} primary />
    {actions.length > 1 && <div className="acc-action-list">{actions.slice(1, 4).map((action) => <ActionCard key={action.title} action={action} />)}</div>}

    {hasPurchases && <MoneySummary money={overview.money} />}

    <section className="acc-section">
      <SectionHead eyebrow="Mis compras" title={active.length ? "Dónde están tus pedidos" : "Tus pedidos"} href="/cuenta/compras" linkText="Ver todas" />
      {active.length
        ? <div className="acc-stack">{active.slice(0, 3).map((purchase) => <PurchaseCard key={purchase.key} purchase={purchase} />)}</div>
        : hasPurchases
          ? <p className="acc-muted acc-card acc-pad">No tienes pedidos en camino. Tus compras anteriores están en <Link className="acc-inline-link" href="/cuenta/compras">Mis compras</Link>.</p>
          : <EmptyState title="Aún no tienes compras" description="Cuando compres, aquí verás tu pedido, lo que has pagado y dónde está en cada momento." href="/catalogo" action="Ver catálogo" />}
      {active.length > 3 && <Link className="acc-link acc-more-link" href="/cuenta/compras">Ver {active.length - 3} pedido(s) más <Icon name="arrow" size={16} /></Link>}
    </section>

    {appointment && <section className="acc-section">
      <SectionHead eyebrow="Entregas" title="Tu próxima cita" href="/cuenta/entregas" linkText="Ver citas" />
      <div className="acc-card acc-appointment">
        <Icon name="calendar" size={24} />
        <div><strong><AppointmentWhen startsAt={appointment.startsAt} endsAt={appointment.endsAt} /></strong><span>{appointment.locationName} · {appointment.deliveryType === "DIDI" ? "Envío por DiDi" : "Recoges en el punto"}</span><small>{appointment.lines.map((l) => l.name).join(", ")}</small></div>
      </div>
    </section>}

    {plan && <section className="acc-section">
      <SectionHead eyebrow="Plan de pagos" title={plan.productName} href="/cuenta/pagos#plan" linkText="Ver calendario" />
      <div className="acc-card acc-pad acc-plan-mini">
        <p><strong>{plan.paidCount} de {plan.installments.length}</strong> pagos completos · {plan.modeLabel}</p>
        <div className="acc-bar" role="progressbar" aria-valuenow={plan.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del plan"><span style={{ width: `${plan.progress}%` }} /></div>
      </div>
    </section>}

    {overview.notifications.length > 0 && <section className="acc-section">
      <SectionHead eyebrow="Avisos" title="Lo más reciente" href="/cuenta/notificaciones" linkText="Ver todos" />
      <ul className="acc-card acc-notice-list">{overview.notifications.slice(0, 3).map((n) => <li key={n.id} className={n.read_at ? "" : "is-unread"}><span className="acc-dot" aria-hidden="true" /><div><strong>{n.title}</strong><p>{n.body}</p><small>{formatDateShort(n.created_at)}</small></div></li>)}</ul>
    </section>}

    {telegramUrl && <TelegramCard href={telegramUrl} />}
  </main>;
}
