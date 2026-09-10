import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="VENDER"
      title="Por ordenar"
      phase="Fase 2"
      summary="La bandeja de tickets listos para comprarle al proveedor todavía no está construida."
      bullets={[
        "Tickets en estado READY_TO_ORDER agrupados por tienda.",
        "Marcar como ordenado y registrar el número de compra.",
        "Avisar a la clienta cuando su producto se ordena.",
      ]}
      availableNow={[
          { label: "Vender", href: "/admin/vender", description: "Registra una venta de mostrador y descuenta inventario." },
          { label: "Inventario", href: "/admin/inventario", description: "Existencias, costos y alertas de stock bajo." },
      ]}
    />
  );
}
