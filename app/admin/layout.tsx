import { redirect } from "next/navigation";
import { AdminSidebar } from "../../components/navigation/AdminSidebar";
import { AdminTopbar } from "../../components/navigation/AdminTopbar";
import { Card } from "../../components/ui/Card";
import { getAdminSession } from "../../lib/supabase/auth";
import { countPendingRequests } from "../../lib/supabase/delivery-requests";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  // Only an active OWNER gets past this point (see getAdminSession). Checked as
  // "anything but authorized" so a future session kind can never fall through.
  if (session.kind !== "authorized") {
    if (session.kind === "unauthenticated") redirect("/login?next=%2Fadmin");
    // Employees have their own panel; /admin is never theirs.
    if (session.isEmployee) redirect("/empleado");
    return <main className="simple-page"><div className="shell narrow-shell"><Card className="empty-state"><span aria-hidden>LF</span><h3>Acceso no autorizado</h3><p>Tu sesión es válida, pero no tienes un perfil administrativo activo.</p><form action="/auth/signout" method="post"><button className="button button-secondary button-small" type="submit">Cerrar sesión</button></form></Card></div></main>;
  }

  // Delivery requests waiting for the owner (migration 020); 0 without it or on any error.
  const pendingRequests = await countPendingRequests();
  return <div className="admin-shell"><AdminSidebar counts={{ "/admin/agenda": pendingRequests }}/><div className="admin-main"><AdminTopbar displayName={session.admin.display_name} businessName="Luxury Finds"/>{children}</div></div>;
}
