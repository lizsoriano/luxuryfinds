import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from "../../../lib/format";
import { getSignedProofUrl, listPendingProofs, listRecentProofDecisions } from "../../../lib/supabase/admin-cobranza";
import { approvePaymentProofAction } from "./actions";
import { RejectProofDialog } from "./RejectProofDialog";

export const dynamic = "force-dynamic";

export default async function CobranzaPage() {
  let pending;
  let recent;
  try {
    [pending, recent] = await Promise.all([listPendingProofs(), listRecentProofDecisions()]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="BALANCE" title="Cobranza" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los comprobantes: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  const withUrls = await Promise.all(
    pending.map(async (proof) => ({ ...proof, signedUrl: await getSignedProofUrl(proof.storage_key) })),
  );

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="BALANCE"
        title="Cobranza"
        description="Comprobantes que las clientas suben desde su cuenta para las cuotas de su plan semanal. Aprobar uno aplica el pago a sus cuotas más antiguas; rechazarlo le avisa por Telegram."
      />

      <Card className="admin-panel">
        <div className="section-heading">
          <div>
            <p className="micro-label">POR REVISAR</p>
            <h2>{pending.length} comprobante(s) pendiente(s)</h2>
          </div>
        </div>
        {withUrls.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Enviado</th>
                  <th>Ticket</th>
                  <th>Clienta</th>
                  <th className="numeric">Monto reportado</th>
                  <th>Método</th>
                  <th>Comprobante</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {withUrls.map((proof) => (
                  <tr key={proof.id}>
                    <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(proof.uploaded_at)}</td>
                    <td>
                      <strong>{proof.ticketNumber}</strong>
                      <span className="admin-cell-sub">{proof.productName}</span>
                    </td>
                    <td>
                      {proof.clientName}
                      <span className="admin-cell-sub">{proof.clientPhone}</span>
                    </td>
                    <td className="numeric">{formatMoney(proof.reported_amount_cents)}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{PAYMENT_METHOD_LABELS[proof.payment_method] ?? proof.payment_method}</td>
                    <td>
                      {proof.signedUrl ? (
                        <a href={proof.signedUrl} target="_blank" rel="noreferrer" style={{ color: "var(--terracotta)", fontWeight: 700 }}>
                          Ver archivo
                        </a>
                      ) : (
                        <span className="admin-hint">No disponible</span>
                      )}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <ConfirmAction
                          action={approvePaymentProofAction}
                          fields={{ id: proof.id }}
                          triggerLabel="Aprobar"
                          title="Aprobar comprobante"
                          description={`Se registrará un pago de ${formatMoney(proof.reported_amount_cents)} y se aplicará a las cuotas más antiguas del ticket ${proof.ticketNumber}.`}
                          confirmLabel="Aprobar pago"
                          variant="primary"
                        />
                        <RejectProofDialog proofId={proof.id} ticketNumber={proof.ticketNumber} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin comprobantes pendientes" description="Los comprobantes que las clientas suban desde su cuenta aparecerán aquí." />
        )}
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">HISTORIAL</p>
            <h2>Últimas decisiones</h2>
          </div>
        </div>
        {recent.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Ticket</th>
                  <th className="numeric">Monto</th>
                  <th>Estado</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((decision) => (
                  <tr key={decision.id}>
                    <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(decision.validated_at)}</td>
                    <td>
                      <strong>{decision.ticketNumber}</strong>
                      <span className="admin-cell-sub">{decision.productName}</span>
                    </td>
                    <td className="numeric">{formatMoney(decision.reported_amount_cents)}</td>
                    <td>
                      <Badge tone={decision.status === "APPROVED" ? "success" : "danger"}>
                        {decision.status === "APPROVED" ? "Aprobado" : "Rechazado"}
                      </Badge>
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{decision.rejection_reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin historial todavía" description="Las decisiones que tomes sobre comprobantes quedarán aquí." />
        )}
      </Card>
    </main>
  );
}
