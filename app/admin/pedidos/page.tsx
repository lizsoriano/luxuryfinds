import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="VENDER"
      title="Pedidos"
      phase="Fase 2"
      summary="Los pedidos del catálogo (los que se convierten en tickets con plan de pagos o apartado) todavía no tienen pantalla propia en el panel."
      bullets={[
        "Listado de pedidos con su clienta, productos y estado.",
        "Confirmar un pedido y generar sus tickets.",
        "Ver el plan de pagos y el avance de cada ticket.",
        "Registrar pedidos manuales desde el panel.",
      ]}
      availableNow={[
          { label: "Vender", href: "/admin/vender", description: "Registra una venta de mostrador y descuenta inventario." },
          { label: "Inventario", href: "/admin/inventario", description: "Existencias, costos y alertas de stock bajo." },
          { label: "Clientes", href: "/admin/clientes", description: "Fichas, historial de compras y totales por clienta." },
      ]}
    />
  );
}
