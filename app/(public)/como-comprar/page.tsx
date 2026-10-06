import Link from "next/link";
import { PolicyLinks } from "./PolicyLinks";
import { PageHeader } from "../../../components/ui/PageHeader";

export const metadata = { title: "Cómo comprar y reglas de compra", description: "Anticipos, liquidación, planes de pagos, apartados, resguardo y entregas de Luxury Finds." };

const liquidation = [
  "Se solicita un anticipo del 50% del precio del producto. El precio publicado es final; el envío se cobra por separado. Todo está sujeto a disponibilidad y stock limitado.",
  "Cuando el producto llegue y te notifiquemos, tienes un máximo de 3 días naturales para liquidar el saldo restante. Revisa la fecha límite indicada en el aviso. El plazo comienza con la notificación de llegada, no con el pedido. Los fines de semana y festivos sí cuentan para liquidar.",
  "Después de los 3 días comienza el atraso y se aplica un cargo de $100 MXN por semana de retraso. El cargo es adicional al saldo del artículo; no es un abono al precio ni amplía el plazo.",
  "Al cumplir dos semanas de atraso se pierde el producto y el anticipo, sin reembolso ni excepciones. Los demás abonos realizados tampoco se reembolsan. La mercancía vuelve a estar disponible para venta. Las dos semanas se cuentan desde el vencimiento de la liquidación, no desde la compra.",
  "Una vez confirmado y pagado el pedido, no se permiten cambios de artículo ni cancelaciones por decisión de la compradora.",
];

const policies = [
  { id: "compras-instantaneas", title: "1. Compras al instante desde USA", paragraphs: [
    "Compramos desde San Diego en Ross, Burlington, TJ Maxx, Marshalls, Steve Madden, Coach y otras tiendas. Comparte el artículo, modelo, color y talla; confirmamos disponibilidad y condiciones antes de pagar.", ...liquidation,
  ] },
  { id: "pre-order", title: "2. Productos bajo pedido o pre-order", paragraphs: [
    "Compramos productos especialmente para ti en sitios web de las marcas, distribuidores oficiales o tiendas físicas. Si buscas un artículo no publicado, escríbenos para cotizarlo.",
    "La llegada estimada es de 20 a 30 días hábiles: lunes a viernes, excluyendo fines de semana y días festivos de México y USA, más preparación y empaquetado. Puede variar por tienda, proveedor, disponibilidad, logística o paquetería. Informaremos los plazos especiales antes de confirmar la compra.", ...liquidation,
    "Los 20 a 30 días hábiles son un tiempo estimado de llegada, no un plazo de liquidación. Si tu artículo bajo pedido se adquiere mediante un plan de pagos o apartado expresamente ofrecido, se aplican las fechas de esa modalidad.",
  ] },
  { id: "planes", title: "3. Planes de pagos en artículos seleccionados", paragraphs: [
    "Solo participan los artículos cuya publicación indique expresamente que entran en plan de pagos. No aplica automáticamente a todas las bolsas ni a todos los productos.",
    "Planes semanales de 4 a 16 semanas según el artículo. Antes del primer pago te informamos el total, los abonos y las fechas. Los planes más largos pueden tener un total mayor.",
    "Cada abono debe reflejarse el día acordado de la semana, el mismo día en que se generó el pedido. Si se refleja al día siguiente, incluso de madrugada, se considera retraso y genera un cargo de $100 MXN. El comprobante no sustituye que el pago se refleje a tiempo.",
    "Puedes adelantar abonos o liquidar antes, pero el total del plan elegido se mantiene. Ejemplo: un plan de 8 semanas conserva el total acordado aunque lo pagues en menos semanas o en una sola exhibición.",
    "Si acumulas dos semanas consecutivas de atraso o decides dejar de pagar, se pierde el artículo y todo lo abonado, sin reembolso ni excepciones. No se entrega y vuelve a estar disponible para venta. Una vez iniciado, no se permiten cambios de artículo ni cancelaciones por decisión de la compradora.",
    "Si está en stock, se entrega después de liquidar. Si es bajo pedido, se solicita en el penúltimo pago y la llegada depende del proveedor y la paquetería. Liquidar un artículo bajo pedido no significa que ya esté disponible físicamente.",
    "Si al solicitarlo en el penúltimo pago no está disponible, puedes elegir otro producto disponible, otro modelo o solicitar devolución de lo abonado. Esta opción corresponde a falta de disponibilidad del proveedor; no a dejar de pagar ni a cancelar por decisión propia.",
    "El primer pago confirma la aceptación del total, calendario y condiciones del plan. Una vez liquidado y listo para entrega, también aplica el mes de resguardo de la sección 5.",
  ] },
  { id: "apartados", title: "4. Sistema de apartado", paragraphs: [
    "Solo aplica cuando indiquemos que el producto está disponible para apartado. Se reserva con un mínimo del 30% del precio total. Es una modalidad distinta de la compra con 50% de anticipo y liquidación a la llegada.",
    "Tienes 30 días naturales desde la fecha del apartado para liquidar. Fines de semana y festivos cuentan. Puedes abonar o liquidar antes; los abonos no reinician ni amplían el plazo.",
    "Si no liquidas dentro de los 30 días o decides cancelar, se pierde el producto y todo lo abonado, sin reembolso ni excepciones. La mercancía queda disponible para venta. Una vez iniciado no se permiten cambios de artículo ni cancelaciones por decisión de la compradora.",
    "Si está en stock, se entrega al liquidar. Si es bajo pedido, se compra cuando completes el pago y a partir de entonces comienza el tiempo de espera. No se solicita al proveedor con el primer anticipo de apartado.",
    "El plazo del apartado es para pagar. Una vez liquidado y listo para entrega, aplica además el mes de resguardo para recoger o coordinar el envío.",
  ] },
  { id: "resguardo", title: "5. Productos liquidados pendientes de recoger o enviar", paragraphs: [
    "Aunque tu producto esté totalmente pagado, debes coordinar su entrega. El resguardo máximo es de un mes natural desde que te avisemos que está listo para entrega. No comienza con la orden ni mientras el producto sigue en camino.",
    "Dentro de ese mes debes recogerlo, recibirlo por entrega local o pagar y coordinar el envío nacional. Para envío nacional se requieren ambas acciones: pagar sin coordinar, o solicitar sin pagar, no cumple la condición.",
    "Una vez vencido el mes, se pierde el producto y el monto total pagado, sin reembolso ni excepciones. La mercancía vuelve a estar disponible para venta, incluso si ya estaba completamente liquidada.",
    "Aplica si no pasas a recoger, no solicitas ni concretas la entrega local, no pagas o no coordinas el envío nacional, dejas de responder o no das seguimiento. Avisar de un inconveniente, mandar un mensaje o solicitar una entrega sin concretarla no amplía el plazo.",
    "Aplica a todos los productos liquidados: compra directa, pre-order, apartado y plan de pagos. Terminar de pagar un plan no elimina la obligación de recibir o coordinar el envío dentro del mes de resguardo.",
    "Un mes natural es un mes calendario, no 30 días hábiles. Consulta la fecha límite indicada en el aviso y coordina con anticipación.",
  ] },
  { id: "entregas", title: "6. Envíos y puntos de entrega", paragraphs: [
    "Envíos nacionales desde $150 MXN mediante Estafeta. Entregas en La Paz desde $45 MXN, según ubicación. El envío se cobra por separado del producto. Confirma el costo de tu destino antes de pagar.",
    "Villas del Encanto: de 4:00 p. m. a 8:00 p. m. Indeco: de 8:30 a. m. a 12:00 p. m.",
    "Tec de La Paz: aproximadamente de 1:00 p. m. a 9:00 p. m.; puede variar dependiendo del día.",
    "Zona Centro, cerca de la Normal Urbana: únicamente a las 9:00 a. m. o a las 5:00 p. m. Son dos horarios puntuales, no un intervalo continuo.",
    "Confirma con anticipación el día, horario y punto por WhatsApp o mensaje directo y espera nuestra confirmación antes de acudir. Un horario publicado no equivale a una cita confirmada.",
    "Para DiDi Entregas proporciona dirección, nombre y teléfono correctos y mantente pendiente para recibir al mensajero. Los costos adicionales por entregas fallidas o reprogramaciones corren por cuenta de la compradora. Si hay una incidencia durante el traslado, avísanos para darle seguimiento con la plataforma.",
    "Solicitar o reprogramar una entrega no amplía el mes de resguardo. Coordina con tiempo suficiente para concretarla dentro del plazo.",
  ] },
  { id: "pagos", title: "7. Métodos de pago y comprobantes", paragraphs: [
    "Aceptamos transferencia, depósito, efectivo, retiro sin tarjeta y link de pago. Solicita los datos o el link a Luxury Finds y envía tu comprobante para registrar cada pago.",
    "El pago debe realizarse y reflejarse en las fechas de tu modalidad. Indica a qué pedido corresponde. Elegir otro método de pago no cambia la fecha límite.",
    "Cuando indiquemos un plazo de 24 horas para confirmar el pago, el pedido podrá cancelarse si no recibimos el pago y su comprobante dentro de ese tiempo. Este plazo no reemplaza las fechas de liquidación ni las del plan o apartado.",
  ] },
  { id: "cancelaciones", title: "8. Cambios y cancelaciones", paragraphs: [
    "No hay cambios ni devoluciones por decisión de la compradora una vez confirmada la compra. Revisa modelo, color, talla y características antes de pagar; con gusto resolvemos tus dudas.",
    "Luxury Finds puede cancelar pedidos por falta de disponibilidad, pagos fraudulentos o incumplimiento. Si no podemos cumplir con un producto, te avisamos y puedes elegir otro producto, otro modelo o solicitar devolución. La falta de disponibilidad en planes se explica en la sección 3.",
    "Las pérdidas por incumplir los plazos de pago o resguardo se aplican sin reembolso ni excepciones. En los casos de incumplimiento descritos se pierde el artículo y lo abonado; cuando vence el resguardo de un producto liquidado se pierde el total pagado.",
    "Antes de confirmar, revisa la modalidad, total, fechas de pago y entrega. Comprar con anticipo, apartar y usar un plan de pagos son modalidades distintas; una no se convierte automáticamente en otra.",
  ] },
];

const questions = [
  { question: "¿El precio incluye envío?", answer: "El precio del artículo es final. El envío se cobra por separado: nacional por Estafeta desde $150 MXN y en La Paz desde $45 MXN, según destino." },
  { question: "¿Cuándo liquido una compra con anticipo del 50%?", answer: "Máximo 3 días naturales desde que llegue y te notifiquemos. Aplica tanto a compras al instante como a pre-order con anticipo. Después hay un cargo de $100 MXN por semana; al cumplir dos semanas de atraso pierdes el artículo y lo abonado, sin reembolso ni excepciones." },
  { question: "¿Cualquier artículo puede tener plan de pagos?", answer: "Solo los artículos cuya publicación lo indique expresamente. Debes seguir el calendario y total pactados; adelantar pagos no reduce el total." },
  { question: "¿Apartado y anticipo del 50% son lo mismo?", answer: "No. El apartado ofrecido empieza con mínimo 30% y se liquida en 30 días naturales desde el apartado. La compra con 50% de anticipo se liquida como máximo 3 días después de la llegada y notificación." },
  { question: "¿Puedo dejar guardado algo ya pagado?", answer: "Solo un mes natural desde el aviso de producto listo. Al vencer pierdes el producto y el total pagado, sin reembolso ni excepciones. Avisar de un inconveniente no amplía el plazo." },
  { question: "¿Tienen entrega inmediata?", answer: <>Sí. Consulta el stock físico en La Paz en <Link href="/entrega-inmediata">Entrega inmediata</Link>. Los <Link href="/productos-en-camino">Productos en camino</Link> todavía deben llegar antes de entregarse.</> },
  { question: "¿Cómo cotizo algo que no está publicado?", answer: <>Escríbenos en <a href="https://www.instagram.com/luxury_finds_mx/">Instagram, @luxury_finds_mx</a>, con el modelo, talla o color que buscas.</> },
];

export default function HowToPage() {
  return <main className="faq-page"><div className="shell">
    <PageHeader eyebrow="LUXURY FINDS PERSONAL SHOPPER" title={<>Cómo comprar, <em>paso a paso.</em></>} description="Consulta la modalidad de tu artículo antes de pagar: anticipos, fechas, entregas y consecuencias de cada caso." />
    <div className="faq-layout"><div className="faq-main">
      <section className="faq-panel" aria-labelledby="rules-summary"><h2 id="rules-summary">Los plazos que debes recordar</h2><ul>
        <li><strong>Compra al instante y pre-order:</strong> 50% de anticipo, máximo 3 días para liquidar desde la llegada y notificación. Cargo de $100 MXN por semana; dos semanas de atraso implican perder el artículo y lo abonado.</li>
        <li><strong>Plan de pagos:</strong> solo artículos señalados, pagos semanales en la fecha acordada. Dos semanas consecutivas de atraso o dejar de pagar implica perder el artículo y lo abonado.</li>
        <li><strong>Apartado:</strong> mínimo 30%, máximo 30 días naturales desde el apartado. Incumplir o cancelar implica perder el artículo y lo abonado.</li>
        <li><strong>Producto liquidado:</strong> un mes natural de resguardo desde el aviso de producto listo. Al vencer se pierde el artículo y el total pagado.</li>
      </ul><p><strong>Las pérdidas por incumplimiento son sin reembolso ni excepciones.</strong> El tiempo de llegada, el plazo para pagar y el plazo para recibir son distintos. Consulta el detalle de tu modalidad abajo.</p></section>
      <section className="faq-panel faq-policy-panel" aria-labelledby="faq-policies-title"><p className="section-label">REGLAS POR MODALIDAD</p><h2 id="faq-policies-title">Políticas y condiciones completas</h2>{policies.map(item => <details className="faq-item" id={item.id} key={item.id} open><summary>{item.title}<span className="faq-toggle" aria-hidden="true" /></summary><div className="faq-answer">{item.paragraphs.map(text => <p key={text}>{text}</p>)}</div></details>)}</section>
      <section className="faq-panel" aria-labelledby="faq-title"><h2 id="faq-title">Preguntas frecuentes</h2><div className="faq-questions">{questions.map(item => <details className="faq-item" key={item.question}><summary>{item.question}<span className="faq-toggle" aria-hidden="true" /></summary><div className="faq-answer"><p>{item.answer}</p></div></details>)}</div></section>
    </div><aside className="faq-sidebar"><section className="faq-panel"><h2>Consulta cada modalidad</h2><PolicyLinks policies={policies.map(({ id, title }) => ({ id, title }))} /></section><section className="faq-panel faq-provider"><p className="section-label">ANTES DE PAGAR</p><h2>Confirma tu compra</h2><p>Consulta artículo, modalidad, total, fechas y entrega. Estamos en La Paz, Baja California Sur.</p><Link href="/contacto" className="button button-primary">Contáctanos</Link><a className="faq-instagram" href="https://www.instagram.com/luxury_finds_mx/">@luxury_finds_mx</a></section></aside></div>
  </div></main>;
}
