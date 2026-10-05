import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

/**
 * En camino / recepción plugs into the shipments of "Compras con shopper"
 * (phase 3, tables not built yet). Until then this section says so honestly.
 */
export default function StaffReceptionPage() {
  return (
    <div className="staff-coming-soon">
      <ComingSoon
        eyebrow="EN CAMINO / RECEPCIÓN"
        title="Recepción de embarques"
        phase="la siguiente etapa"
        summary="Aquí vas a recibir lo que llega de EE.UU.: comparar lo que se esperaba contra lo que llegó, con fotos y observaciones. Se activa cuando el módulo de embarques esté listo."
        bullets={[
          "Ver los embarques en camino y lo que trae cada uno.",
          "Contar lo recibido: unidades en buen estado, dañadas y faltantes, con fotos y observaciones.",
          "Solo lo recibido en buen estado pasa a disponible o listo para entregar; lo faltante queda pendiente en el embarque.",
        ]}
        availableNow={[
          { label: "Inventario en La Paz", href: "/empleado/inventario", description: "Registra entradas de mercancía que ya está aquí." },
          { label: "Entregas programadas", href: "/empleado/entregas", description: "Las citas de entrega del día." },
        ]}
      />
    </div>
  );
}
