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

  return <main className="login-page login-page-simple"><Card className="login-card login-card-simple"><div className="login-card-heading"><h1>Bienvenido</h1></div>{hasPublicSupabaseEnv() ? <LoginForm next={next}/> : <p className="form-message form-error" role="alert">La conexión segura no está configurada en este entorno.</p>}</Card></main>;
}