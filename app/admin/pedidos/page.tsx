import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatDateTime, formatMoney } from "../../../lib/format";
import { listOrders, type OrderStatus } from "../../../lib/supabase/admin-orders";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; status?: string; page?: string };

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

const ORIGIN_LABELS: Record<string, string> = { WEBSITE: "Sitio web", ADMIN_MANUAL: "Manual" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  let result;
  try {
    result = await listOrders({ search: sp.q?.trim() || undefined, status: sp.status, page: Number(sp.page) || 1 });
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="VENDER" title="Pedidos" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los pedidos: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="VENDER"
        title="Pedidos"
        description="Los pedidos que entran desde el sitio web. Confírmalos para generar sus tickets y descontar inventario, o cancélalos si no van a proceder."
      />

      <FilterForm action="/admin/pedidos">
        <label className="field admin-toolbar-grow" htmlFor="orders-search">
          <span>Buscar</span>
          <input id="orders-search" className="input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Nombre o teléfono de la clienta…" />
        </label>
        <label className="field" htmlFor="orders-status">
          <span>Estado</span>
          <select id="orders-status" className="input" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todos</option>
            <option value="DRAFT">Por confirmar</option>
            <option value="CONFIRMED">Confirmado</option>
            <option value="COMPLETED">Completado</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Buscar
          </Button>
        </div>
      </FilterForm>

      <Card className="admin-panel">
        {result.orders.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Clienta</th>
                  <th className="numeric">Artículos</th>
                  <th className="numeric">Total</th>
                  <th>Origen</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {result.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.id.slice(0, 8).toUpperCase()}</strong>
                    </td>
                    <td>{order.client ? `${order.client.first_name} ${order.client.last_name}`.trim() : "—"}</td>
                    <td className="numeric">{order.itemCount}</td>
                    <td className="numeric">{formatMoney(order.totalCents)}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{ORIGIN_LABELS[order.origin] ?? order.origin}</td>
                    <td>
                      <Badge tone={STATUS_TONES[order.status]}>{STATUS_LABELS[order.status]}</Badge>
                      {order.requestedPaymentPlan.mode === "WEEKLY_PLAN" && (
                        <span className="admin-cell-sub">Plan semanal · {order.requestedPaymentPlan.numberOfWeeks} sem.</span>
                      )}
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(order.created_at)}</td>
                    <td>
                      <Button href={`/admin/pedidos/${order.id}`} variant="secondary" size="small">
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={sp.q || sp.status ? "Sin resultados" : "Aún no hay pedidos"}
            description={
              sp.q || sp.status
                ? "Prueba con otro nombre, teléfono o estado."
                : "Los pedidos que las clientas hagan desde el carrito del sitio web aparecerán aquí."
            }
          />
        )}
        <Pagination
          basePath="/admin/pedidos"
          params={{ q: sp.q, status: sp.status }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hasNextPage={result.hasNextPage}
        />
      </Card>
    </main>
  );
}
