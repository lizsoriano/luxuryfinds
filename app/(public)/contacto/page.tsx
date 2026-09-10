import { PageHeader } from "../../../components/ui/PageHeader";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";

export const metadata = { title: "Contacto | Luxury Finds" };

export default function ContactPage() {
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
          <h2>WhatsApp</h2>
          <p>Respondemos de lunes a viernes. Es la forma más rápida de contactarnos.</p>
          <Button href="https://wa.me/526122343170" variant="primary" size="small">Escribir por WhatsApp</Button>
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
