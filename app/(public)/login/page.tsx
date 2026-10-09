import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "../../../components/ui/Card";
import { hasPublicSupabaseEnv } from "../../../lib/supabase/env";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = "/cuenta" } = await searchParams;
  if (hasPublicSupabaseEnv()) {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/cuenta");
  }

  return <main className="login-page"><div className="login-visual"><div className="login-photo-frame"><img src="/images/login-shopping.png" alt="Selección de ropa, bolsos y accesorios de Luxury Finds en un carrito de compras" width={1189} height={1590} fetchPriority="high" /></div></div><Card className="login-card"><div className="login-card-heading"><span>LF</span><h2>Inicia sesión</h2><p>Entra con tu celular y contraseña, o con tu correo y contraseña.</p></div>{hasPublicSupabaseEnv() ? <><LoginForm next={next}/><p className="auth-switch-link">¿No tienes cuenta? <Link href={`/crear-cuenta?next=${encodeURIComponent(next)}`}>Crea una</Link></p></> : <p className="form-message form-error" role="alert">La conexión segura no está configurada en este entorno.</p>}<p className="login-help">¿Necesitas ayuda para entrar?<br/><Link href="/contacto">Escríbenos por Telegram</Link></p></Card></main>;
}
