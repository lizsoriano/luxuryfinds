import Link from "next/link";
import { Icon } from "../../../components/account/AccountIcons";
import { AddressForm } from "../../../components/account/AddressForm";
import { ChangePasswordForm } from "../../../components/account/ChangePasswordForm";
import { getClientProfile } from "../../../lib/supabase/auth";
import { adminDb } from "../../../lib/supabase/business";
import { getTelegramLinkUrl } from "../../../lib/telegram/env";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { user, profile } = await getClientProfile();
  // Only her own row, by the verified session id.
  const { data: extra } = profile ? await adminDb().from("clients").select("address, telegram_chat_id").eq("id", user.id).maybeSingle() : { data: null };
  const telegramLinked = Boolean(extra?.telegram_chat_id);
  const telegramUrl = telegramLinked ? null : getTelegramLinkUrl(user.id);
  return <main className="account-content acc-content">
    <header className="acc-page-head"><h1>Mi perfil</h1></header>
    <div className="acc-stack">
      <section className="acc-card acc-pad">
        <h2 className="acc-h2">Mis datos</h2>
        {profile ? <dl className="acc-profile">
          <div><dt>Nombre</dt><dd>{profile.first_name} {profile.last_name}</dd></div>
          <div><dt>Celular</dt><dd>{profile.phone}</dd></div>
          <div><dt>Correo</dt><dd>{profile.email ?? "Sin correo"}</dd></div>
        </dl> : <p className="acc-muted">Tu perfil aún no está listo.</p>}
        <p className="acc-muted">Tu nombre, celular y correo son tu acceso: para cambiarlos <Link className="acc-inline-link" href="/contacto">escríbenos</Link>.</p>
      </section>
      {profile && <section className="acc-card acc-pad">
        <h2 className="acc-h2">Dirección de entrega</h2>
        <p className="acc-muted">La usamos cuando eliges envío por DiDi.</p>
        <AddressForm address={(extra?.address as string | null) ?? null} />
      </section>}
      <section className="acc-card acc-pad acc-telegram-status">
        <h2 className="acc-h2">Avisos por Telegram</h2>
        {telegramLinked ? <p><Icon name="check" size={18} /> Vinculado. Te escribimos cuando tu pedido avance.</p>
          : telegramUrl ? <><p className="acc-muted">Recibe en Telegram los avisos de tus pedidos y pagos.</p><a className="button button-secondary acc-btn" href={telegramUrl} target="_blank" rel="noreferrer">Vincular Telegram</a></>
            : <p className="acc-muted">Los avisos por Telegram no están disponibles por ahora.</p>}
      </section>
      <section className="acc-card acc-pad">
        <h2 className="acc-h2">Cambiar contraseña</h2>
        <p className="acc-muted">Elige una de al menos 8 caracteres.</p>
        <ChangePasswordForm />
      </section>
      <form action="/auth/signout" method="post"><button type="submit" className="button button-secondary acc-btn acc-btn-full">Cerrar sesión</button></form>
    </div>
  </main>;
}
