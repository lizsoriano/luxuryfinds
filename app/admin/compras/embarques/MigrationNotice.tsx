import { Card } from "../../../../components/ui/Card";
import { shipmentUnavailableMessage, type ShipmentSchemaState } from "../../../../lib/supabase/admin-shipments";

/** Shown instead of the Embarques screens until 014 (and 010/011 before it) is applied. */
export function ShipmentMigrationNotice({ state }: { state: ShipmentSchemaState }) {
  const message = shipmentUnavailableMessage(state);
  if (!message) return null;
  return (
    <Card className="admin-panel" style={{ marginTop: 24 }}>
      <p className="form-message form-error" role="alert">
        {message}
      </p>
      <p className="admin-hint" style={{ marginTop: 12 }}>
        {state === "missing-014"
          ? "Es un archivo SQL que se corre una sola vez en el editor SQL de Supabase. Crea los embarques, sus líneas y las recepciones en La Paz, con el reparto del costo de envío."
          : "Son archivos SQL que se corren una sola vez, en ese orden, en el editor SQL de Supabase."}{" "}
        Hasta entonces los embarques no se pueden crear ni consultar; el resto del panel (compras, asignaciones, pedidos,
        En camino y Agenda) funciona igual.
      </p>
    </Card>
  );
}
