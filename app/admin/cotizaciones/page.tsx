import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="GESTIONA TU NEGOCIO"
      title="Cotizaciones"
      phase="Fase 2"
      summary="Las cotizaciones (presupuestos que todavía no son una venta) aún no existen: no hay tabla ni pantalla, así que las fichas de clienta tampoco muestran cotizaciones."
      bullets={[
        "Crear una cotización con productos y vigencia.",
        "Enviarla a la clienta y darle seguimiento.",
        "Convertirla en venta o en pedido con un clic.",
      ]}
      availableNow={[
          { label: "Vender", href: "/admin/vender", description: "Registra una venta de mostrador y descuenta inventario." },
          { label: "Inventario", href: "/admin/inventario", description: "Existencias, costos y alertas de stock bajo." },
          { label: "Clientes", href: "/admin/clientes", description: "Fichas, historial de compras y totales por clienta." },
      ]}
    />
  );
}
