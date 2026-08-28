import { redirect } from "next/navigation";
import { AdminSidebar } from "../../components/navigation/AdminSidebar";
import { Card } from "../../components/ui/Card";
import { getAdminSession } from "../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (session.kind === "unauthenticated") redirect("/login?next=%2Fadmin");
  if (session.kind === "unauthorized") return <main className="simple-page"><div className="shell narrow-shell"><Card className="empty-state"><span aria-hidden>LF</span><h3>Acceso no autorizado</h3><p>Tu sesión es válida, pero no tienes un perfil administrativo activo.</p><form action="/auth/signout" method="post"><button className="button button-secondary button-small" type="submit">Cerrar sesión</button></form></Card></div></main>;

  return <div className="admin-shell"><AdminSidebar/><div className="admin-mobile-bar"><span className="admin-wordmark"><span>Luxury</span> Finds<small>ADMIN</small></span><button type="button" aria-label="Abrir navegación">☰</button></div><div className="admin-main"><header className="admin-topbar"><label><span className="sr-only">Buscar</span><input type="search" placeholder="Buscar clienta, ticket o producto…"/></label><div><button type="button" aria-label="Notificaciones">○</button><p><strong>{session.admin.display_name}</strong><small>Administración</small></p><span className="account-avatar">LF</span><form action="/auth/signout" method="post"><button type="submit" aria-label="Cerrar sesión">Salir</button></form></div></header>{children}</div></div>;
}
