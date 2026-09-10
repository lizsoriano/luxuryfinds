import { PageHeader } from "../../../components/ui/PageHeader";
import { Card } from "../../../components/ui/Card";

export const metadata = { title: "Políticas | Luxury Finds" };

const sections = [
  {
    title: "Modalidades de pago",
    body: "Puedes pagar de tres formas: pago completo, plan semanal (de 4 a 16 semanas) o apartado. El apartado solo aplica para productos de entrega inmediata y requiere un mínimo del 30% del precio total.",
  },
  {
    title: "Métodos de pago",
    body: "Aceptamos transferencia, efectivo y link de pago. Por ahora no procesamos pagos automáticos con tarjeta.",
  },
  {
    title: "Planes de pago semanales",
    body: "Los pagos se realizan el mismo día de la semana en que inició tu plan, antes de las 11:59 p. m. Un pago no cubierto a tiempo genera una multa de $100 MXN, registrada por separado del precio del producto. Puedes adelantar cuotas o liquidar antes de tiempo, aunque el total pactado no se reduce por pagar anticipadamente.",
  },
  {
    title: "Incumplimiento del plan",
    body: "Si acumulas dos semanas consecutivas de retraso, el plan se considera incumplido: el producto no se entrega y no aplica devolución por incumplimiento. Tu historial de pagos permanece registrado.",
  },
  {
    title: "Cancelaciones por parte de Luxury Finds",
    body: "Si no podemos cumplir con un producto (agotado, cancelado por el proveedor, dañado, perdido o imposible de conseguir), te avisamos y puedes elegir: encargar otro producto, cambiarlo por uno disponible, o solicitar devolución.",
  },
  {
    title: "Solicitudes de devolución",
    body: "Para procesar tu devolución te pediremos nombre, apellido y los datos bancarios necesarios (evitamos solicitar el número completo de tarjeta). Tu pago original nunca se elimina de tu historial.",
  },
  {
    title: "Entregas",
    body: "Las entregas se agendan una vez que tu producto está listo, en bloques de 10 minutos dentro de los horarios disponibles que publicamos. Te contactaremos para coordinar la tuya.",
  },
];

export default function PoliciesPage() {
  return <main className="simple-page">
    <div className="shell narrow-shell">
      <PageHeader
        eyebrow="COMPRA CON CONFIANZA"
        title={<>Nuestras <em>políticas.</em></>}
        description="Así funcionan los pagos, cancelaciones, devoluciones y entregas en Luxury Finds."
      />
      <div className="policy-list">
        {sections.map((s) => (
          <Card className="policy-card" key={s.title}>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </Card>
        ))}
      </div>
    </div>
  </main>;
}
