import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffNav } from "../../components/navigation/StaffNav";
import { initialsOf } from "../../lib/format";
import { getStaffSession } from "../../lib/supabase/auth";
import { EMPLOYEE_ROLES_MIGRATION_FILE, STAFF_ROLE_LABELS } from "../../lib/supabase/staff-roles";

export const dynamic = "force-dynamic";

function SignOut({ label = "Salir" }: { label?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className="staff-signout">
        {label}
      </button>
    </form>
  );
}

function Blocked({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="staff-blocked">
      <div className="staff-blocked-card">
        <span aria-hidden>LF</span>
        <h1>{title}</h1>
        {children}
        <SignOut label="Cerrar sesión" />
      </div>
    </main>
  );
}

/**
 * The staff panel. Its own shell (not the owner's sidebar), mobile first.
 * Access: an active OWNER or EMPLOYEE (lib/supabase/auth.ts#getStaffSession).
 * A clienta is sent to her account; nobody without a session gets past /login.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (session.kind === "unauthenticated") redirect("/login?next=%2Fempleado");
  if (session.kind === "unauthorized") redirect("/cuenta");
  if (session.kind === "unavailable") {
    return (
      <Blocked title="El panel de empleado aún no está activo">
        <p>
          Falta aplicar <code>{EMPLOYEE_ROLES_MIGRATION_FILE}</code> en el editor SQL de Supabase. Mientras tanto
          todo lo demás funciona igual.
        </p>
        <Link className="button button-secondary button-small" href="/admin">
          Ir al panel de la dueña
        </Link>
      </Blocked>
    );
  }
  if (session.kind === "inactive") {
    return (
      <Blocked title="Tu acceso está desactivado">
        <p>Pídele a la dueña que lo reactive si lo necesitas.</p>
      </Blocked>
    );
  }
  if (session.kind !== "authorized") redirect("/login?next=%2Fempleado");

  const { staff } = session;
  return (
    <div className="staff-shell">
      <header className="staff-topbar">
        <div className="staff-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.webp" alt="" />
          <p>
            <strong>Luxury Finds</strong>
            <small>Panel de empleado</small>
          </p>
        </div>
        <div className="staff-user">
          <span className="staff-avatar" aria-hidden>
            {initialsOf(staff.display_name)}
          </span>
          <p>
            <strong>{staff.display_name}</strong>
            <small>{STAFF_ROLE_LABELS[staff.role]}</small>
          </p>
          <SignOut />
        </div>
      </header>
      <StaffNav />
      <div className="staff-main">{children}</div>
    </div>
  );
}
