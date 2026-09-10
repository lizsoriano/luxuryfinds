import { notFound } from "next/navigation";
import { ConfirmAction } from "../../../../components/admin/ConfirmAction";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { formatDateTime, formatMoney } from "../../../../lib/format";
import { getOrderDetail, type OrderStatus } from "../../../../lib/supabase/admin-orders";
import { cancelOrderAction, confirmOrderAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: "Por confirmar",
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  COMPLETED: "Completado",
};

const STATUS_TONES: Record<OrderStatus, "neutral" | "rose" | "success" | "warning" | "danger"> = {
  DRAFT: "warning",
  CONFIRMED: "success",
  CANCELLED: "danger",
  COMPLETED: "neutral",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail;
  try {
    detail = await getOrderDetail(id);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="VENDER" title="Pedido" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar el pedido: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }
  if (!detail) notFound();

  const { order, client, items, tickets } = detail;
  const totalCents = items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
  const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada";
  const isWeeklyPlanRequest = order.requestedPaymentPlan.mode === "WEEKLY_PLAN";

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="VENDER"
        title={`Pedido ${order.id.slice(0, 8).toUpperCase()}`}
        description={`${clientName}${client?.phone ? ` · ${client.phone}` : ""}${client?.email ? ` · ${client.email}` : ""}`}
        action={
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button href="/admin/pedidos" variant="secondary" size="small">
              Volver
            </Button>
            {order.status === "DRAFT" && (
              <ConfirmAction
                action={confirmOrderAction}
                fields={{ id: order.id }}
                triggerLabel="Confirmar pedido"
                title="Confirmar pedido"
                description={
                  isWeeklyPlanRequest
                    ? `Se generará un ticket por cada artículo (${items.length}) en plan semanal a ${order.requestedPaymentPlan.numberOfWeeks} semanas, con su tabla de cuotas, y se descontará el inventario correspondiente. Esta acción no se puede deshacer.`
                    : `Se generará un ticket por cada artículo (${items.length}) y se descontará el inventario correspondiente. Esta acción no se puede deshacer.`
                }
                confirmLabel="Confirmar y generar tickets"
                variant="primary"
              />
            )}
            {(order.status === "DRAFT" || order.status === "CONFIRMED") && (
              <ConfirmAction
                action={cancelOrderAction}
                fields={{ id: order.id }}
                triggerLabel="Cancelar pedido"
                title="Cancelar pedido"
                description={
                  order.status === "CONFIRMED"
                    ? "Esto cancelará sus tickets y liberará el inventario que se había descontado."
                    : "Este pedido pasará a cancelado."
                }
                confirmLabel="Cancelar pedido"
                variant="danger"
              />
            )}
          </span>
        }
      />

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">DETALLE</p>
            <h2>Artículos</h2>
          </div>
          <Badge tone={STATUS_TONES[order.status]}>{STATUS_LABELS[order.status]}</Badge>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Variante</th>
                <th className="numeric">Cantidad</th>
                <th className="numeric">Precio</th>
                <th className="numeric">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.productName ?? "Producto eliminado"}</td>
                  <td style={{ color: "var(--admin-muted)" }}>{item.variantName ?? "—"}</td>
                  <td className="numeric">{item.quantity}</td>
                  <td className="numeric">{formatMoney(item.unit_price_cents)}</td>
                  <td className="numeric">{formatMoney(item.unit_price_cents * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>
                  Total
                </td>
                <td className="numeric" style={{ fontWeight: 600 }}>
                  {formatMoney(totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {isWeeklyPlanRequest && (
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Modalidad solicitada: <strong>plan semanal a {order.requestedPaymentPlan.numberOfWeeks} semanas</strong>.
          </p>
        )}
        {order.client_notes && (
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Nota de la clienta: {order.client_notes}
          </p>
        )}
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">SEGUIMIENTO</p>
            <h2>Tickets</h2>
          </div>
        </div>
        {tickets.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Producto</th>
                  <th className="numeric">Cantidad</th>
                  <th className="numeric">Total</th>
                  <th>Estado financiero</th>
                  <th>Logística</th>
                  <th>Plan de pagos</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => {
                  const plan = ticket.paymentPlan;
                  const paidCount = plan?.installments.filter((installment) => installment.status === "PAID").length ?? 0;
                  const nextDue = plan?.installments.find((installment) => installment.status !== "PAID");
                  return (
                    <tr key={ticket.id}>
                      <td>
                        <strong>{ticket.ticket_number}</strong>
                      </td>
                      <td>
                        {ticket.product_name_snapshot}
                        {ticket.variant_name_snapshot ? <span className="admin-cell-sub">{ticket.variant_name_snapshot}</span> : null}
                      </td>
                      <td className="numeric">{ticket.quantity}</td>
                      <td className="numeric">{formatMoney(ticket.agreed_total_cents)}</td>
                      <td style={{ color: "var(--admin-muted)" }}>{ticket.financial_status}</td>
                      <td style={{ color: "var(--admin-muted)" }}>{ticket.logistics_status}</td>
                      <td style={{ color: "var(--admin-muted)" }}>
                        {plan ? (
                          <>
                            {paidCount} de {plan.installments.length} cuotas pagadas
                            {nextDue ? (
                              <span className="admin-cell-sub">
                                Próxima: {formatMoney(nextDue.amount_cents)} · {formatDateTime(nextDue.due_at)}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          "Pago completo"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Sin tickets todavía"
            description={
              order.status === "DRAFT"
                ? "Confirma el pedido para generar un ticket por cada artículo."
                : "Este pedido no generó tickets."
            }
          />
        )}
      </Card>

      <p className="admin-hint" style={{ marginTop: 4 }}>
        Creado el {formatDateTime(order.created_at)}
        {order.confirmed_at ? ` · Confirmado el ${formatDateTime(order.confirmed_at)}` : ""}
        {order.cancelled_at ? ` · Cancelado el ${formatDateTime(order.cancelled_at)}` : ""}
      </p>
    </main>
  );
}
