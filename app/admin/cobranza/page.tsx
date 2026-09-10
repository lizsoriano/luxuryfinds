import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="BALANCE"
      title="Cobranza"
      phase="Fase 2"
      summary="La validación de comprobantes y el seguimiento de pagos semanales se ven hoy resumidos en el Resumen, pero no tienen pantalla dedicada."
      bullets={[
        "Validar o rechazar comprobantes de pago.",
        "Registrar pagos manuales y aplicarlos a las letras del plan.",
        "Ver vencimientos, recargos por mora y planes en incumplimiento.",
      ]}
      availableNow={[
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
          { label: "Resumen", href: "/admin", description: "Pagos por validar y vencimientos de hoy." },
      ]}
    />
  );
}
