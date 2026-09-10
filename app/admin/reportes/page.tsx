import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="ESTADÍSTICAS"
      title="Reportes"
      phase="Fase 3"
      summary="Los reportes descargables llegan junto con el módulo de estadísticas."
      bullets={[
        "Reporte de ventas por periodo, producto y categoría.",
        "Reporte de cobranza y morosidad.",
        "Exportación a Excel y CSV.",
      ]}
      availableNow={[
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
      ]}
    />
  );
}
