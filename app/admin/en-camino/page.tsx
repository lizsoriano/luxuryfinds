import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="VENDER"
      title="En camino"
      phase="Fase 2"
      summary="El seguimiento logístico de los tickets en tránsito todavía no está construido."
      bullets={[
        "Tickets ORDERED, IN_TRANSIT y RECEIVED_LA_PAZ.",
        "Cambiar el estado logístico y notificar a la clienta.",
        "Marcar como listo para entrega.",
      ]}
      availableNow={[
          { label: "Vender", href: "/admin/vender", description: "Registra una venta de mostrador y descuenta inventario." },
          { label: "Inventario", href: "/admin/inventario", description: "Existencias, costos y alertas de stock bajo." },
      ]}
    />
  );
}
