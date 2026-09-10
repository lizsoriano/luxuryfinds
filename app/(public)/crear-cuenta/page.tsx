import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "../../../components/ui/Card";
import { SectionLabel } from "../../../components/ui/SectionLabel";
import { hasPublicSupabaseEnv } from "../../../lib/supabase/env";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = "/cuenta" } = await searchParams;
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/cuenta";
  if (hasPublicSupabaseEnv()) {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect(safeNext);
  }

  return (
    <main className="login-page signup-page">
      <div className="login-intro">
        <SectionLabel>ÚNETE A LUXURY FINDS</SectionLabel>
        <h1>Crea tu cuenta,<em>en un minuto.</em></h1>
        <p>Registra tus datos para guardar tu historial de compras, pagos y entregas.</p>
        <div className="login-quote">
          <span>“</span>
          <p>Tu cuenta privada te acompaña desde el primer pago hasta la entrega.</p>
        </div>
      </div>
      <Card className="login-card">
        <div className="login-card-heading">
          <span>LF</span>
          <h2>Crea tu cuenta</h2>
          <p>Necesitamos estos datos para asociar tus compras.</p>
        </div>
        {hasPublicSupabaseEnv() ? (
          <>
            <SignupForm next={safeNext} />
            <p className="auth-switch-link">
              ¿Ya tienes cuenta? <Link href={`/login?next=${encodeURIComponent(safeNext)}`}>Inicia sesión</Link>
            </p>
          </>
        ) : (
          <p className="form-message form-error" role="alert">La conexión segura no está configurada en este entorno.</p>
        )}
        <p className="login-help">¿Necesitas ayuda para registrarte?<br /><Link href="/contacto">Escríbenos por WhatsApp</Link></p>
      </Card>
    </main>
  );
}
