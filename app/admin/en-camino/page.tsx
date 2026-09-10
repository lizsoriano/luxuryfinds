import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { listTicketsByLogistics } from "../../../lib/supabase/admin-orders";
import { LogisticsTicketTable } from "../pedidos/LogisticsTicketTable";

export const dynamic = "force-dynamic";

export default async function EnCaminoPage() {
  let tickets;
  try {
    tickets = await listTicketsByLogistics(["ORDERED", "IN_TRANSIT", "RECEIVED_LA_PAZ"]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="VENDER" title="En camino" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los tickets: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="VENDER"
        title="En camino"
        description="Tickets ya ordenados al proveedor, en tránsito o recibidos en La Paz. Actualiza el estado cuando avancen, hasta que queden listos para entrega."
      />
      <Card className="admin-panel">
        <LogisticsTicketTable tickets={tickets} emptyDescription="No hay tickets en tránsito ahora mismo." />
      </Card>
    </main>
  );
}
