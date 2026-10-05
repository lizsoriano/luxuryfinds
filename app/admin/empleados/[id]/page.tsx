import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction } from "../../../../components/admin/ConfirmAction";
import { Badge } from "../../../../components/ui/Badge";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { StatCard } from "../../../../components/ui/StatCard";
import { formatDate, formatDateTime, formatMoney } from "../../../../lib/format";
import { getEmployeeDetail } from "../../../../lib/supabase/admin-employees";
import { STAFF_DELIVERIES_MIGRATION_FILE } from "../../../../lib/supabase/staff-schema";
import { setEmployeeStatusAction } from "../actions";
import { ResetPasswordDialog } from "../EmployeeForms";

export const dynamic = "force-dynamic";

const METHOD: Record<string, string> = { CASH: "Efectivo", TRANSFER: "Transferencia" };

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let employee;
  try {
    employee = await getEmployeeDetail(id);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="EMPLEADOS" title="Empleado" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar al empleado: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }
  if (!employee) notFound();

  const pendingTransfersCents = employee.pendingTransfers.reduce((sum, transfer) => sum + transfer.amountCents, 0);
  const monthCashCents = employee.cashByDay.reduce((sum, day) => sum + day.cashCents, 0);

  return (
    <main className="admin-content">
      <Link href="/admin/empleados" className="admin-inline-link">
        ← Empleados
      </Link>
      <PageHeader
        eyebrow="EMPLEADO"
        title={employee.displayName}
        description={`${employee.email ?? "Sin correo"}${employee.phone ? ` · ${employee.phone}` : ""} · usuario ${employee.username}`}
        action={
          <div className="admin-row-actions">
            <Badge tone={employee.status === "ACTIVE" ? "success" : "neutral"}>{employee.status === "ACTIVE" ? "Activo" : "Desactivado"}</Badge>
            <ResetPasswordDialog employeeId={employee.id} name={employee.displayName} />
            <ConfirmAction
              action={setEmployeeStatusAction}
              fields={{ id: employee.id, active: employee.status === "ACTIVE" ? "false" : "true" }}
              triggerLabel={employee.status === "ACTIVE" ? "Desactivar" : "Reactivar"}
              title={employee.status === "ACTIVE" ? `Desactivar a ${employee.displayName}` : `Reactivar a ${employee.displayName}`}
              description={employee.status === "ACTIVE" ? "Ya no podrá entrar al panel de empleado. Lo que registró se conserva." : "Podrá volver a entrar."}
              confirmLabel={employee.status === "ACTIVE" ? "Desactivar" : "Reactivar"}
              variant={employee.status === "ACTIVE" ? "danger" : "primary"}
            />
          </div>
        }
      />

      {!employee.cashAvailable ? (
        <div className="admin-notice" style={{ marginTop: 20 }}>
          <strong>La caja por empleado aparece al aplicar la migración de entregas.</strong>
          Falta aplicar <code>{STAFF_DELIVERIES_MIGRATION_FILE}</code> en el editor SQL de Supabase.
        </div>
      ) : null}

      <section className="admin-stats">
        <StatCard label="Efectivo de hoy" value={formatMoney(employee.todayCashCents)} note="cobrado por este empleado al entregar" tone="rose" />
        <StatCard label="Efectivo 30 días" value={formatMoney(monthCashCents)} note={`${employee.cashByDay.length} día(s) con entregas`} />
        <StatCard
          label="Transferencias por validar"
          value={formatMoney(pendingTransfersCents)}
          note={`${employee.pendingTransfers.length} comprobante(s) en Cobranza`}
          tone={employee.pendingTransfers.length ? "warning" : "default"}
        />
        <StatCard label="Última actividad" value={employee.lastActivityAt ? formatDate(employee.lastActivityAt) : "—"} note={employee.lastActivity ?? "Sin actividad"} />
      </section>

      <div className="admin-dashboard-grid">
        <Card className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">CAJA</p>
              <h2>Efectivo por día</h2>
            </div>
          </div>
          {employee.cashByDay.length ? (
            <div className="admin-table-scroll">
              <table className="admin-data-table" style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th className="numeric">Entregas</th>
                    <th className="numeric">Efectivo cobrado</th>
                  </tr>
                </thead>
                <tbody>
                  {employee.cashByDay.map((day) => (
                    <tr key={day.day}>
                      <td>{formatDate(day.day)}</td>
                      <td className="numeric">{day.deliveries}</td>
                      <td className="numeric">
                        <strong>{formatMoney(day.cashCents)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Sin entregas en los últimos 30 días" description="Cuando confirme entregas con cobro en efectivo, el total de cada día aparece aquí para cuadrar su caja." />
          )}
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Sin cierre de caja formal todavía: es el efectivo que el panel registró a su nombre, para que lo compares con lo que te entrega.
          </p>
        </Card>

        <Card className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">COBRANZA</p>
              <h2>Transferencias reportadas</h2>
            </div>
          </div>
          {employee.pendingTransfers.length ? (
            <div className="activity-list">
              {employee.pendingTransfers.map((transfer) => (
                <div key={transfer.id}>
                  <span className="activity-icon">$</span>
                  <p>
                    <strong>
                      {formatMoney(transfer.amountCents)} · {transfer.ticketNumber}
                    </strong>
                    <small>{transfer.reference ? `Ref. ${transfer.reference}` : "Sin referencia"}</small>
                  </p>
                  <time>{formatDateTime(transfer.reportedAt)}</time>
                </div>
              ))}
            </div>
          ) : (
            <p className="admin-hint">Nada pendiente de validar.</p>
          )}
          <Link className="button button-secondary button-small" href="/admin/cobranza">
            Validar en Cobranza
          </Link>
        </Card>
      </div>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">ENTREGAS</p>
            <h2>Últimas entregas confirmadas</h2>
          </div>
        </div>
        {employee.recentDeliveries.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Clienta</th>
                  <th>Recibió</th>
                  <th>Cobro</th>
                  <th className="numeric">Importe</th>
                  <th className="numeric">Saldo que quedó</th>
                </tr>
              </thead>
              <tbody>
                {employee.recentDeliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td className="admin-cell-time">{formatDateTime(delivery.deliveredAt)}</td>
                    <td className="admin-cell-name">{delivery.clientName}</td>
                    <td className="admin-cell-muted">{delivery.receivedBy === "OTHER" ? delivery.receiverName ?? "Otra persona" : "La clienta"}</td>
                    <td className="admin-cell-muted">{delivery.method ? METHOD[delivery.method] ?? delivery.method : "Sin cobro"}</td>
                    <td className="numeric">{formatMoney(delivery.amountCents)}</td>
                    <td className="numeric">{delivery.balanceAfterCents ? formatMoney(delivery.balanceAfterCents) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin entregas todavía" description="Las entregas que confirme desde su panel aparecen aquí." />
        )}
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <p className="micro-label">ACTIVIDAD RECIENTE</p>
        {employee.activity.length ? (
          <div className="activity-list" style={{ marginTop: 12 }}>
            {employee.activity.map((entry, index) => (
              <div key={`${entry.at}-${index}`}>
                <span className="activity-icon">·</span>
                <p>
                  <strong>{entry.label}</strong>
                </p>
                <time>{formatDateTime(entry.at)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Sin actividad registrada.
          </p>
        )}
      </Card>
    </main>
  );
}
