import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="GESTIONA TU NEGOCIO"
      title="Empleados"
      phase="Fase 2"
      summary="Por ahora cada venta y cada gasto se registran a nombre del usuario administrador que los capturó. Los perfiles de empleado con permisos propios llegan después."
      bullets={[
        "Alta de empleados con acceso propio al panel.",
        "Permisos por módulo (vender, inventario, balance).",
        "Ventas y cortes de caja por empleado.",
      ]}
      availableNow={[
          { label: "Vender", href: "/admin/vender", description: "Registra una venta de mostrador y descuenta inventario." },
          { label: "Inventario", href: "/admin/inventario", description: "Existencias, costos y alertas de stock bajo." },
          { label: "Balance", href: "/admin/balance", description: "Ingresos, gastos y cierres de caja del periodo." },
      ]}
    />
  );
}
