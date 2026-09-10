import { ComingSoon } from "../../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="FACTURACIÓN"
      title="Facturación global"
      phase="Fase 4"
      summary="La factura global del periodo (ventas al público en general) forma parte del módulo de facturación."
      bullets={[
        "Agrupar las ventas sin factura de un periodo.",
        "Emitir un solo comprobante global.",
        "Consultar comprobantes globales emitidos.",
      ]}
      availableNow={[
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
      ]}
    />
  );
}
