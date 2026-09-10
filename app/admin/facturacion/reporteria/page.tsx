import { ComingSoon } from "../../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="FACTURACIÓN"
      title="Reportería de facturación"
      phase="Fase 4"
      summary="Los reportes fiscales dependen de que primero exista la emisión de comprobantes."
      bullets={[
        "Comprobantes emitidos y cancelados por periodo.",
        "Conciliación entre ventas registradas y facturadas.",
        "Descarga de XML y PDF.",
      ]}
      availableNow={[
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
      ]}
    />
  );
}
