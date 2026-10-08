import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";

export const metadata = { title: "Recuperar acceso | Luxury Finds" };

export default function RecoverAccessPage() {
  return <main className="simple-page"><div className="shell narrow-shell">
    <PageHeader eyebrow="TU CUENTA" title="¿Olvidaste tu contraseña?" description="Te ayudamos a volver a entrar con tu celular." />
    <Card className="recovery-card">
      <h2>Solicita una nueva contraseña</h2>
      <p>Escríbenos por mensaje directo con tu nombre y el celular con el que te registramos. Después de verificar tu identidad, te asignaremos una contraseña nueva.</p>
      <p>Cuando entres, puedes cambiarla en <strong>Mi perfil</strong>. No envíes tu contraseña anterior.</p>
      <Button href="https://www.instagram.com/luxury_finds_mx/" fullWidth>Escribir a Luxury Finds en Instagram</Button>
      <Button href="/login" variant="secondary" fullWidth>Volver a iniciar sesión</Button>
    </Card>
  </div></main>;
}
