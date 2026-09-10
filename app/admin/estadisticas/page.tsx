import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="GESTIONA TU NEGOCIO"
      title="Estadísticas"
      phase="Fase 3"
      summary="Las gráficas de comportamiento del negocio todavía no existen. Hoy los números duros están en Balance e Inventario."
      bullets={[
        "Ventas por día, semana y mes con comparativo.",
        "Productos y categorías más vendidos.",
        "Margen de utilidad usando el costo registrado en cada producto.",
        "Clientas que más compran.",
      ]}
      availableNow={[
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
          { label: "Inventario", href: "/admin/inventario", description: "Costo total y valor del inventario." },
      ]}
    />
  );
}
