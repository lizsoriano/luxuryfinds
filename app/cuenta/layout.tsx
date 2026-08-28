import Link from "next/link";
import { AccountNav } from "../../components/navigation/AccountNav";
import { getClientProfile } from "../../lib/supabase/auth";

export const dynamic = "force-dynamic";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LF";
}

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await getClientProfile();
  const displayName = profile ? `${profile.first_name} ${profile.last_name}` : (user.email ?? user.phone ?? "Mi cuenta");
  return <div className="account-shell"><header className="account-topbar"><Link className="wordmark" href="/"><span>Luxury</span> Finds</Link><div><button type="button" aria-label="Notificaciones">○</button><span className="account-avatar">{initials(displayName)}</span><p><strong>{displayName}</strong><small>Mi cuenta</small></p><form action="/auth/signout" method="post"><button type="submit" aria-label="Cerrar sesión">Salir</button></form></div></header><div className="account-nav-wrap"><AccountNav/></div>{children}<nav className="account-bottom-nav" aria-label="Navegación móvil de mi cuenta"><Link className="active" href="/cuenta"><span>⌂</span>Resumen</Link><Link href="/cuenta/compras"><span>□</span>Compras</Link><Link href="/cuenta/pagos"><span>$</span>Pagos</Link><Link href="/cuenta/perfil"><span>○</span>Perfil</Link></nav></div>;
}
