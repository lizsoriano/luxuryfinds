import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "../../../components/ui/Card";
import { SectionLabel } from "../../../components/ui/SectionLabel";
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

  return <main className="login-page"><div className="login-intro"><SectionLabel>BIENVENIDA DE NUEVO</SectionLabel><h1>Todo lo que elegiste,<em>en un solo lugar.</em></h1><p>Consulta tus compras, pagos, entregas y novedades de Luxury Finds.</p><div className="login-quote"><span>“</span><p>Tu cuenta privada te acompaña desde el primer pago hasta la entrega.</p></div></div><Card className="login-card"><div className="login-card-heading"><span>LF</span><h2>Inicia sesión</h2><p>Ingresa con tus datos de Supabase Auth.</p></div>{hasPublicSupabaseEnv() ? <LoginForm next={next}/> : <p className="form-message form-error" role="alert">La conexión segura no está configurada en este entorno.</p>}<p className="login-help">¿Necesitas ayuda para entrar?<br/><Link href="/contacto">Escríbenos por WhatsApp</Link></p></Card></main>;
}
