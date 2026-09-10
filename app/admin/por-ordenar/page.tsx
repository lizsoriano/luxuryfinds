import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { listTicketsByLogistics } from "../../../lib/supabase/admin-orders";
import { LogisticsTicketTable } from "../pedidos/LogisticsTicketTable";

export const dynamic = "force-dynamic";

export default async function PorOrdenarPage() {
  let tickets;
  try {
    tickets = await listTicketsByLogistics(["WAITING_TO_ORDER", "READY_TO_ORDER"]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="VENDER" title="Por ordenar" />
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
        title="Por ordenar"
        description="Tickets de artículos por pedido que todavía no se compran al proveedor. Actualiza el estado a 'Ordenado' cuando lo hagas."
      />
      <Card className="admin-panel">
        <LogisticsTicketTable tickets={tickets} emptyDescription="No hay tickets esperando ordenarse al proveedor." />
      </Card>
    </main>
  );
}
