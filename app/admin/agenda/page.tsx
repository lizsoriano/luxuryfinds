import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="VENDER"
      title="Agenda de entregas"
      phase="Fase 2"
      summary="La agenda de entregas (ubicaciones, disponibilidades y citas de 10 minutos) ya existe en la base de datos, pero aún no tiene pantalla de administración."
      bullets={[
        "Publicar disponibilidades por ubicación y generar sus horarios.",
        "Ver las citas reservadas del día y marcarlas como completadas.",
        "Cancelar o reagendar una entrega.",
      ]}
      availableNow={[
          { label: "Vender", href: "/admin/vender", description: "Registra una venta de mostrador y descuenta inventario." },
          { label: "Inventario", href: "/admin/inventario", description: "Existencias, costos y alertas de stock bajo." },
      ]}
    />
  );
}
