import { redirect } from "next/navigation";
import { AdminSidebar } from "../../components/navigation/AdminSidebar";
import { AdminTopbar } from "../../components/navigation/AdminTopbar";
import { Card } from "../../components/ui/Card";
import { getAdminSession } from "../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (session.kind === "unauthenticated") redirect("/login?next=%2Fadmin");
  if (session.kind === "unauthorized") return <main className="simple-page"><div className="shell narrow-shell"><Card className="empty-state"><span aria-hidden>LF</span><h3>Acceso no autorizado</h3><p>Tu sesión es válida, pero no tienes un perfil administrativo activo.</p><form action="/auth/signout" method="post"><button className="button button-secondary button-small" type="submit">Cerrar sesión</button></form></Card></div></main>;

  return <div className="admin-shell"><AdminSidebar/><div className="admin-main"><AdminTopbar displayName={session.admin.display_name} businessName="Luxury Finds"/>{children}</div></div>;
}
