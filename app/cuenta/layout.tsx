import Link from "next/link";
import { Icon } from "../../components/account/AccountIcons";
import { AccountNav, AccountBottomNav } from "../../components/navigation/AccountNav";
import { initialsOf } from "../../lib/format";
import { getClientProfile } from "../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, profile } = await getClientProfile();
  const displayName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : (user.email ?? user.phone ?? "Mi cuenta");
  let unread = 0;
  if (profile) {
    // Her own unread notices (RLS: notifications_own_read), just the count for the bell.
    const { count } = await supabase.schema("luxury_finds").from("notifications").select("id", { count: "exact", head: true }).eq("client_id", user.id).is("read_at", null);
    unread = count ?? 0;
  }
  return <div className="account-shell acc-shell">
    <header className="account-topbar acc-topbar">
      <Link className="wordmark" href="/"><span>Luxury</span> Finds</Link>
      <div>
        <Link className="acc-bell" href="/cuenta/notificaciones" aria-label={unread ? `Avisos: ${unread} sin leer` : "Avisos"}><Icon name="bell" size={22} />{unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}</Link>
        <Link className="account-avatar" href="/cuenta/perfil" aria-label="Mi perfil">{initialsOf(displayName)}</Link>
        <form action="/auth/signout" method="post"><button type="submit" className="acc-signout">Salir</button></form>
      </div>
    </header>
    <div className="account-nav-wrap"><AccountNav /></div>
    {children}
    <AccountBottomNav />
  </div>;
}
