import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { formatDate } from "../../../lib/format";
import type { LogisticsTicketRow } from "../../../lib/supabase/admin-orders";
import { AdvanceLogisticsDialog } from "./AdvanceLogisticsDialog";

export function LogisticsTicketTable({ tickets, emptyDescription }: { tickets: LogisticsTicketRow[]; emptyDescription: string }) {
  if (!tickets.length) {
    return <EmptyState title="Nada por aquí" description={emptyDescription} />;
  }

  return (
    <div className="admin-table-scroll">
      <table className="admin-data-table">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Producto</th>
            <th>Clienta</th>
            <th className="numeric">Cantidad</th>
            <th>Tienda / nota</th>
            <th>Desde</th>
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <strong>{ticket.ticket_number}</strong>
              </td>
              <td className="admin-cell-product">
                {ticket.product_name_snapshot}
                {ticket.variant_name_snapshot ? <span className="admin-cell-sub">{ticket.variant_name_snapshot}</span> : null}
              </td>
              <td className="admin-cell-name">
                {ticket.clientName}
                <span className="admin-cell-sub">{ticket.clientPhone}</span>
              </td>
              <td className="numeric">{ticket.quantity}</td>
              <td className="admin-cell-muted">
                {ticket.storeName ?? ticket.notes ?? <Badge tone="neutral">Sin asignar</Badge>}
              </td>
              <td className="admin-cell-muted admin-cell-nowrap">{formatDate(ticket.created_at)}</td>
              <td>
                <AdvanceLogisticsDialog ticketId={ticket.id} ticketNumber={ticket.ticket_number} currentStatus={ticket.logistics_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
