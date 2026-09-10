import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatDate, formatMoney } from "../../../lib/format";
import { listRefundRequests } from "../../../lib/supabase/admin-devoluciones";
import { markRefundInProcessAction } from "./actions";
import { CompleteRefundDialog } from "./CompleteRefundDialog";
import { RejectRefundDialog } from "./RejectRefundDialog";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Solicitado",
  IN_PROCESS: "En proceso",
  COMPLETED: "Completado",
  REJECTED: "Rechazado",
};

export default async function DevolucionesPage() {
  let requests;
  try {
    requests = await listRefundRequests();
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="BALANCE" title="Devoluciones" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar las solicitudes: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="BALANCE"
        title="Devoluciones"
        description="Solicitudes de reembolso que las clientas envían desde su cuenta, con los datos bancarios ya descifrados solo para ti. Requiere REFUND_ENCRYPTION_KEY configurada en el servidor."
      />
      <Card className="admin-panel">
        {requests.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Solicitado</th>
                  <th>Ticket</th>
                  <th>Clienta</th>
                  <th>Cuenta destino</th>
                  <th>Motivo</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td style={{ color: "var(--admin-muted)" }}>{formatDate(request.requested_at)}</td>
                    <td>
                      <strong>{request.ticketNumber}</strong>
                      <span className="admin-cell-sub">
                        {request.productName} · {formatMoney(request.agreedTotalCents)}
                      </span>
                    </td>
                    <td>
                      {request.clientName}
                      <span className="admin-cell-sub">{request.clientPhone}</span>
                    </td>
                    <td>
                      {request.accountHolderName}
                      <span className="admin-cell-sub">
                        {request.bankName} · {request.clabe ?? "No se pudo descifrar"}
                      </span>
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{request.reason}</td>
                    <td>
                      <Badge tone={request.status === "REQUESTED" ? "warning" : "neutral"}>{STATUS_LABELS[request.status] ?? request.status}</Badge>
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        {request.status === "REQUESTED" && (
                          <ConfirmAction
                            action={markRefundInProcessAction}
                            fields={{ id: request.id }}
                            triggerLabel="En proceso"
                            title="Marcar en proceso"
                            description="Indica que ya estás gestionando esta devolución."
                            confirmLabel="Marcar en proceso"
                            variant="secondary"
                          />
                        )}
                        <CompleteRefundDialog requestId={request.id} ticketNumber={request.ticketNumber} suggestedAmountCents={request.agreedTotalCents} />
                        <RejectRefundDialog requestId={request.id} ticketNumber={request.ticketNumber} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin solicitudes pendientes" description="Las solicitudes de reembolso que las clientas envíen desde su cuenta aparecerán aquí." />
        )}
      </Card>
    </main>
  );
}
