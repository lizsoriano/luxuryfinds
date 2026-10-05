import Link from "next/link";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { listTicketsByLogistics } from "../../../lib/supabase/admin-orders";
import { listReceptionIncidentTickets } from "../../../lib/supabase/admin-shipments";
import { LogisticsTicketTable } from "../pedidos/LogisticsTicketTable";

export const dynamic = "force-dynamic";

export default async function EnCaminoPage() {
  let tickets;
  let incidents: Awaited<ReturnType<typeof listReceptionIncidentTickets>> = [];
  try {
    [tickets, incidents] = await Promise.all([
      listTicketsByLogistics(["ORDERED", "IN_TRANSIT", "RECEIVED_LA_PAZ"]),
      // Tickets a shipment reception left in "Recibido en La Paz" with damaged/missing units (014). [] without it.
      listReceptionIncidentTickets(),
    ]);
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
      {incidents.length ? (
        <div className="admin-notice" style={{ marginBottom: 16 }}>
          <strong>{incidents.length} ticket(s) llegaron con piezas dañadas o faltantes y no pasaron a listos para entrega.</strong>
          <ul className="ship-incident-list">
            {incidents.map((ticket) => (
              <li key={ticket.id}>
                <b>{ticket.ticket_number}</b> · {ticket.product_name}: {ticket.incident_reason}
              </li>
            ))}
          </ul>
          Decide qué hacer (reponer, ajustar o reembolsar). El detalle y las fotos están en{" "}
          <Link className="assign-ticket-link" href="/admin/compras/embarques?estado=INCIDENTS">Compras › Embarques</Link>.
        </div>
      ) : null}
      <Card className="admin-panel">
        <LogisticsTicketTable tickets={tickets} emptyDescription="No hay tickets en tránsito ahora mismo." />
      </Card>
    </main>
  );
}
