import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="BALANCE"
      title="Devoluciones"
      phase="Fase 2"
      summary="Las solicitudes de reembolso ya se guardan en la base de datos, pero aún no se administran desde aquí."
      bullets={[
        "Solicitudes de reembolso con sus datos bancarios cifrados.",
        "Marcar un reembolso como procesado y registrar la referencia.",
        "Resolver incidencias con producto de reemplazo o saldo a favor.",
      ]}
      availableNow={[
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
      ]}
    />
  );
}
