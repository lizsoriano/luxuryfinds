import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="GESTIONA TU NEGOCIO"
      title="Facturación"
      phase="Fase 4"
      summary="La facturación electrónica implica conectar un proveedor autorizado (PAC) y timbrar comprobantes fiscales. No está construida ni simulada."
      bullets={[
        "Datos fiscales del negocio y de cada clienta.",
        "Emisión de CFDI a partir de una venta o un ticket.",
        "Cancelación y reenvío de comprobantes.",
      ]}
      availableNow={[
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
      ]}
    />
  );
}
