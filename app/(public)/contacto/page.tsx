import { PageHeader } from "../../../components/ui/PageHeader";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { hasTelegramEnv, getTelegramEnv } from "../../../lib/telegram/env";

export const metadata = { title: "Contacto | Luxury Finds" };

export default function ContactPage() {
  const telegramUrl = hasTelegramEnv() ? `https://t.me/${getTelegramEnv().botUsername}` : "https://t.me/";
  return <main className="simple-page">
    <div className="shell narrow-shell">
      <PageHeader
        eyebrow="ESTAMOS CERCA"
        title={<>Escríbenos, <em>con gusto te ayudamos.</em></>}
        description="¿Dudas sobre un producto, un pedido o tu cuenta? Contáctanos directo."
      />
      <div className="steps-grid">
        <Card className="step-card">
          <span aria-hidden>💬</span>
          <h2>Telegram</h2>
          <p>Respondemos de lunes a viernes. Es la forma más rápida de contactarnos.</p>
          <Button href={telegramUrl} variant="primary" size="small">Escribir por Telegram</Button>
        </Card>
        <Card className="step-card">
          <span aria-hidden>📷</span>
          <h2>Instagram</h2>
          <p>Sigue nuestras novedades y hallazgos recién llegados.</p>
          <Button href="https://instagram.com/luxuryfindsmx" variant="secondary" size="small">@luxuryfindsmx</Button>
        </Card>
        <Card className="step-card">
          <span aria-hidden>📍</span>
          <h2>Ubicación</h2>
          <p>La Paz, Baja California Sur. Entregas locales y envíos por pedido.</p>
        </Card>
      </div>
    </div>
  </main>;
}
