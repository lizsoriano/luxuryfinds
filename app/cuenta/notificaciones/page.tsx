import Link from "next/link";
import { MarkReadButton } from "../../../components/account/MarkReadButton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { formatDateShort, formatTimeOnly } from "../../../lib/account-view";
import { getAccountOverview } from "../../../lib/supabase/account";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const data = await getAccountOverview();
  const overview = data.overview;
  const notifications = overview?.notifications ?? [];
  const purchaseByTicket = new Map((overview?.purchases ?? []).flatMap((p) => p.lines.flatMap((l) => l.ticketId ? [[l.ticketId, p.key] as const] : [])));
  return <main className="account-content acc-content">
    <header className="acc-page-head acc-head-row"><div><h1>Avisos</h1><p>{overview?.unreadCount ? `Tienes ${overview.unreadCount} sin leer.` : "Estás al día."}</p></div>{overview?.unreadCount ? <MarkReadButton label="Marcar todo como leído" /> : null}</header>
    {notifications.length
      ? <ul className="acc-card acc-notice-list acc-notice-full">{notifications.map((n) => {
        const key = n.ticket_id ? purchaseByTicket.get(n.ticket_id) : null;
        return <li key={n.id} className={n.read_at ? "" : "is-unread"}><span className="acc-dot" aria-hidden="true" /><div>
          <strong>{n.title}</strong><p>{n.body}</p>
          <small>{formatDateShort(n.created_at)} · {formatTimeOnly(n.created_at)}</small>
          <div className="acc-notice-actions">{key && <Link className="acc-inline-link" href={`/cuenta/compras/${key}`}>Ver compra</Link>}{!n.read_at && <MarkReadButton id={n.id} label="Marcar como leído" />}</div>
        </div></li>;
      })}</ul>
      : <EmptyState title="No tienes avisos" description="Aquí te contaremos cuando tu pedido avance, esté listo o recibamos tu pago." />}
  </main>;
}
