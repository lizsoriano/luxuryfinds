import { ChangePasswordForm } from "../../../components/account/ChangePasswordForm";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getClientProfile } from "../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { profile } = await getClientProfile();
  return <main className="account-content">
    <PageHeader eyebrow="MI CUENTA" title="Mi perfil" />
    <section className="account-grid">
      <Card className="proof-card">
        <h2>Mis datos</h2>
        {profile && <><p>{profile.first_name} {profile.last_name}</p><p>Celular: {profile.phone}</p>{profile.email && <p>Correo: {profile.email}</p>}</>}
      </Card>
      <Card className="proof-card">
        <h2>Cambiar contraseña</h2>
        <p>Esta contraseña sirve para entrar a tu cuenta. Elige una de al menos 8 caracteres.</p>
        <ChangePasswordForm />
      </Card>
    </section>
  </main>;
}
