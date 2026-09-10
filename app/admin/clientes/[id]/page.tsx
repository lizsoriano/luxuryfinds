import { notFound } from "next/navigation";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { StatCard } from "../../../../components/ui/StatCard";
import { formatDate, formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from "../../../../lib/format";
import { getClientDetail } from "../../../../lib/supabase/admin-contacts";
import { ClientDialog } from "../ClientDialog";

export const dynamic = "force-dynamic";

const PAYMENT_MODE_LABELS: Record<string, string> = {
  FULL: "Pago completo",
  WEEKLY_PLAN: "Plan semanal",
  LAYAWAY: "Apartado",
};

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail;
  try {
    detail = await getClientDetail(id);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="CONTACTOS" title="Ficha de clienta" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar la ficha: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }
  if (!detail) notFound();

  const { client, tickets, sales, metrics, salesUnavailable } = detail;
  const name = `${client.first_name} ${client.last_name}`.trim();

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="CONTACTOS"
        title={name}
        description={`${client.phone}${client.email ? ` · ${client.email}` : ""}${
          client.instagram ? ` · ${client.instagram}` : ""
        }`}
        action={
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button href="/admin/clientes" variant="secondary" size="small">
              Volver
            </Button>
            <ClientDialog
              triggerLabel="Editar ficha"
              client={{
                id: client.id,
                first_name: client.first_name,
                last_name: client.last_name,
                phone: client.phone,
                email: client.email,
                instagram: client.instagram,
                address: client.address,
                internal_notes: client.internal_notes,
                payment_plans_allowed: client.payment_plans_allowed,
              }}
            />
          </span>
        }
      />

      <section className="admin-stats">
        <StatCard label="COMPRAS" value={String(metrics.purchaseCount)} note="Tickets + ventas directas" />
        <StatCard label="TOTAL COMPRADO" value={formatMoney(metrics.totalCents)} note="Histórico" tone="rose" />
        <StatCard label="ÚLTIMA COMPRA" value={formatDate(metrics.lastPurchaseAt)} note="Fecha más reciente" />
        <StatCard
          label="SALDO A FAVOR"
          value={formatMoney(client.credit_balance_cents)}
          note={client.payment_plans_allowed ? "Planes de pago habilitados" : "Sin planes de pago"}
        />
      </section>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">HISTORIAL</p>
            <h2>Tickets del catálogo</h2>
          </div>
          <Badge tone={client.status === "ACTIVE" ? "success" : "neutral"}>
            {client.status === "ACTIVE" ? "Activa" : client.status === "BLOCKED" ? "Bloqueada" : "Archivada"}
          </Badge>
        </div>
        {tickets.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Producto</th>
                  <th>Modalidad</th>
                  <th className="numeric">Total</th>
                  <th>Estado financiero</th>
                  <th>Logística</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id as string}>
                    <td>
                      <strong>{ticket.ticket_number as string}</strong>
                    </td>
                    <td>{ticket.product_name_snapshot as string}</td>
                    <td>{PAYMENT_MODE_LABELS[ticket.payment_mode as string] ?? (ticket.payment_mode as string)}</td>
                    <td className="numeric">{formatMoney(Number(ticket.agreed_total_cents ?? 0))}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{ticket.financial_status as string}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{ticket.logistics_status as string}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{formatDate(ticket.created_at as string)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin tickets" description="Esta clienta todavía no tiene compras del catálogo por pedido." />
        )}
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">HISTORIAL</p>
            <h2>Ventas directas</h2>
          </div>
          <Button href="/admin/vender" variant="secondary" size="small">
            Nueva venta
          </Button>
        </div>
        {salesUnavailable ? (
          <p className="form-message form-error" role="alert">
            No fue posible leer las ventas directas. Aplica database/migrations/002_business_management.sql en Supabase.
          </p>
        ) : sales.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Concepto</th>
                  <th>Método</th>
                  <th className="numeric">Total</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id as string}>
                    <td>
                      <strong>{sale.sale_number as string}</strong>
                    </td>
                    <td>{(sale.concept as string | null) ?? "Venta de productos"}</td>
                    <td>{PAYMENT_METHOD_LABELS[sale.payment_method as string] ?? (sale.payment_method as string)}</td>
                    <td className="numeric">{formatMoney(Number(sale.total_cents ?? 0))}</td>
                    <td>
                      <Badge tone={sale.status === "COMPLETED" ? "success" : "neutral"}>
                        {sale.status === "COMPLETED" ? "Completada" : "Cancelada"}
                      </Badge>
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(sale.sold_at as string)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin ventas directas" description="Las ventas de mostrador aparecerán aquí." />
        )}
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <p className="micro-label">COTIZACIONES</p>
        <div className="admin-notice">
          <strong>Próximamente · Fase 2.</strong>
          El módulo de cotizaciones todavía no existe, así que esta clienta no puede tener cotizaciones
          asociadas. Cuando se construya, aparecerán aquí.
        </div>
      </Card>

      {client.internal_notes ? (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <p className="micro-label">NOTAS INTERNAS</p>
          <p style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7 }}>{client.internal_notes}</p>
        </Card>
      ) : null}
    </main>
  );
}
