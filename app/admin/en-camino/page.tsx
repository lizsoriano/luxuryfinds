import Link from "next/link";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatMoney, formatQuantity } from "../../../lib/format";
import { listProducts } from "../../../lib/supabase/admin-catalog";
import { listTicketsByLogistics } from "../../../lib/supabase/admin-orders";
import { listReceptionIncidentTickets } from "../../../lib/supabase/admin-shipments";
import { LogisticsTicketTable } from "../pedidos/LogisticsTicketTable";

export const dynamic = "force-dynamic";

export default async function EnCaminoPage() {
  let tickets;
  let incidents: Awaited<ReturnType<typeof listReceptionIncidentTickets>> = [];
  // Her own merchandise already bought and on its way (products.in_transit), not client tickets.
  let ownProducts: Awaited<ReturnType<typeof listProducts>> | null = null;
  try {
    ownProducts = await listProducts({ segment: "en-camino", pageSize: 100 });
  } catch {
    ownProducts = null;
  }
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
        description="Tu mercancía en camino (productos que ya compraste y vienen a La Paz) y los tickets de clientas ya ordenados, en tránsito o recibidos en La Paz."
      />
      <Card className="admin-panel" style={{ marginBottom: 16 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">MERCANCÍA PROPIA</p>
            <h2>Productos en camino{ownProducts && !ownProducts.unavailable ? ` (${ownProducts.total})` : ""}</h2>
          </div>
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button href="/admin/vender" variant="secondary" size="small">Vender</Button>
            <Button href="/admin/productos/en-camino" size="small">Administrar / marcar recibido</Button>
          </span>
        </div>
        {!ownProducts ? (
          <p className="admin-hint">No pudimos cargar tus productos en camino. Revisa Inventario › Productos en camino.</p>
        ) : ownProducts.unavailable ? (
          <p className="admin-hint">Falta aplicar la migración 008 (productos en camino) en Supabase.</p>
        ) : ownProducts.products.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="numeric">Cantidad</th>
                  <th className="numeric">Precio</th>
                  <th>Catálogo</th>
                </tr>
              </thead>
              <tbody>
                {ownProducts.products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link href={`/admin/productos/${product.id}`} className="admin-cell-main admin-cell-link">
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="admin-thumb" src={product.imageUrl} alt="" />
                        ) : (
                          <span className="admin-thumb admin-thumb-fallback" aria-hidden>LF</span>
                        )}
                        <span>
                          <strong>{product.name}</strong>
                          <span className="admin-cell-sub">{product.variants.length} variante(s)</span>
                        </span>
                      </Link>
                    </td>
                    <td className="numeric">{formatQuantity(product.stock, product.variants[0]?.unit_label)}</td>
                    <td className="numeric">{formatMoney(product.priceCents)}</td>
                    <td>
                      {product.is_public ? <Badge tone="success">Visible</Badge> : <Badge tone="warning">Oculto</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-hint">No tienes productos marcados como &ldquo;Viene en camino&rdquo;.</p>
        )}
      </Card>
      <p className="micro-label" style={{ margin: "8px 0" }}>TICKETS DE CLIENTAS EN TRÁNSITO</p>
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
