import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatDate, formatMoney, initialsOf } from "../../../lib/format";
import { listClients } from "../../../lib/supabase/admin-contacts";
import { ClientDialog } from "./ClientDialog";
import { setClientStatusAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; archivados?: string; page?: string };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const includeArchived = sp.archivados === "1";

  let result;
  try {
    result = await listClients({
      search: sp.q?.trim() || undefined,
      includeArchived,
      page: Number(sp.page) || 1,
    });
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="CONTACTOS" title="Clientes" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar las clientas: {error instanceof Error ? error.message : "error desconocido"}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Si el error menciona permisos sobre <code>clients</code>, aplica
            database/migrations/000_fix_clients_service_role_grant.sql.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="CONTACTOS"
        title="Clientes"
        description="La misma ficha que usa el sitio público, los pedidos y los planes de pago. Aquí ves cuánto ha comprado cada clienta en total."
        action={<ClientDialog triggerLabel="Nueva clienta ＋" />}
      />

      <FilterForm action="/admin/clientes">
        <label className="field admin-toolbar-grow" htmlFor="clients-search">
          <span>Buscar</span>
          <input
            id="clients-search"
            className="input"
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Nombre, celular, correo o Instagram…"
          />
        </label>
        <label className="admin-switch" htmlFor="clients-archived">
          <input id="clients-archived" type="checkbox" name="archivados" value="1" defaultChecked={includeArchived} />
          <span>Incluir archivadas</span>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Buscar
          </Button>
        </div>
      </FilterForm>

      <Card className="admin-panel">
        {result.clients.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Clienta</th>
                  <th>Contacto</th>
                  <th className="numeric">Compras</th>
                  <th className="numeric">Total comprado</th>
                  <th>Última compra</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {result.clients.map((client) => {
                  const name = `${client.first_name} ${client.last_name}`.trim();
                  const metrics = result.metrics.get(client.id) ?? {
                    purchaseCount: 0,
                    totalCents: 0,
                    lastPurchaseAt: null,
                  };
                  return (
                    <tr key={client.id}>
                      <td>
                        <div className="admin-cell-main">
                          <span className="admin-thumb admin-thumb-fallback" aria-hidden>
                            {initialsOf(name)}
                          </span>
                          <span>
                            <strong>{name}</strong>
                            {client.payment_plans_allowed ? (
                              <span className="admin-cell-sub">Planes de pago habilitados</span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td style={{ color: "var(--admin-muted)" }}>
                        {client.phone}
                        {client.email ? <span className="admin-cell-sub">{client.email}</span> : null}
                      </td>
                      <td className="numeric">{metrics.purchaseCount}</td>
                      <td className="numeric">{formatMoney(metrics.totalCents)}</td>
                      <td style={{ color: "var(--admin-muted)" }}>{formatDate(metrics.lastPurchaseAt)}</td>
                      <td>
                        {client.status === "ACTIVE" ? (
                          <Badge tone="success">Activa</Badge>
                        ) : client.status === "BLOCKED" ? (
                          <Badge tone="danger">Bloqueada</Badge>
                        ) : (
                          <Badge tone="neutral">Archivada</Badge>
                        )}
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <Button href={`/admin/clientes/${client.id}`} variant="secondary" size="small">
                            Ver ficha
                          </Button>
                          <ConfirmAction
                            action={setClientStatusAction}
                            fields={{ id: client.id, status: client.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }}
                            triggerLabel={client.status === "ACTIVE" ? "Archivar" : "Reactivar"}
                            title={client.status === "ACTIVE" ? "Archivar clienta" : "Reactivar clienta"}
                            description={
                              client.status === "ACTIVE"
                                ? `${name} dejará de aparecer en los listados activos y en el selector de ventas. Sus pedidos, tickets y pagos se conservan intactos.`
                                : `${name} volverá a los listados activos.`
                            }
                            confirmLabel={client.status === "ACTIVE" ? "Archivar" : "Reactivar"}
                            variant={client.status === "ACTIVE" ? "danger" : "primary"}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={sp.q ? "Sin resultados" : "Aún no tienes clientas registradas"}
            description={
              sp.q
                ? "Prueba con otro nombre, celular o correo."
                : "Registra una clienta para poder asignarle ventas, pedidos y planes de pago."
            }
          />
        )}
        <Pagination
          basePath="/admin/clientes"
          params={{ q: sp.q, archivados: sp.archivados }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hasNextPage={result.hasNextPage}
        />
      </Card>
    </main>
  );
}
