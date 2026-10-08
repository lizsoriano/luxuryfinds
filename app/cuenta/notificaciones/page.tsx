import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getAccountData } from "../../../lib/supabase/account";

export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  const data = await getAccountData();
  const notifications = data.profile ? data.notifications : [];
  return <main className="account-content"><PageHeader eyebrow="MI CUENTA" title="Notificaciones" />{notifications.length ? notifications.map(notification => <Card className="proof-card" key={notification.id}><h2>{notification.title}</h2><p>{notification.body}</p><small>{notification.created_at.slice(0, 10)}</small></Card>) : <EmptyState title="No tienes notificaciones" description="Te mostraremos aquí las novedades de tus compras." />}</main>;
}
