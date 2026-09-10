import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatMoney, initialsOf } from "../../../lib/format";
import { listSuppliers } from "../../../lib/supabase/admin-contacts";
import { SupplierDialog } from "./SupplierDialog";
import { setSupplierActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; archivados?: string; page?: string };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const includeArchived = sp.archivados === "1";

  let result;
  try {
    result = await listSuppliers({
      search: sp.q?.trim() || undefined,
      includeArchived,
      page: Number(sp.page) || 1,
    });
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="CONTACTOS" title="Proveedores" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los proveedores: {error instanceof Error ? error.message : "error desconocido"}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            La tabla <code>suppliers</code> se crea en database/migrations/002_business_management.sql. Ejecuta esa
            migración en el editor SQL de Supabase y vuelve a cargar.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="CONTACTOS"
        title="Proveedores"
        description="A quién le compras. Es distinto de las marcas del catálogo: aquí van los contactos con los que registras gastos."
        action={<SupplierDialog triggerLabel="Nuevo proveedor ＋" />}
      />

      <FilterForm action="/admin/proveedores">
        <label className="field admin-toolbar-grow" htmlFor="suppliers-search">
          <span>Buscar</span>
          <input
            id="suppliers-search"
            className="input"
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Nombre, empresa, teléfono o correo…"
          />
        </label>
        <label className="admin-switch" htmlFor="suppliers-archived">
          <input id="suppliers-archived" type="checkbox" name="archivados" value="1" defaultChecked={includeArchived} />
          <span>Incluir archivados</span>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Buscar
          </Button>
        </div>
      </FilterForm>

      <Card className="admin-panel">
        {result.suppliers.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Contacto</th>
                  <th className="numeric">Gastos</th>
                  <th className="numeric">Total gastado</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {result.suppliers.map((supplier) => {
                  const spend = result.spend.get(supplier.id) ?? { expenseCount: 0, totalCents: 0 };
                  return (
                    <tr key={supplier.id}>
                      <td>
                        <div className="admin-cell-main">
                          <span className="admin-thumb admin-thumb-fallback" aria-hidden>
                            {initialsOf(supplier.company || supplier.name)}
                          </span>
                          <span>
                            <strong>{supplier.name}</strong>
                            {supplier.company ? <span className="admin-cell-sub">{supplier.company}</span> : null}
                          </span>
                        </div>
                      </td>
                      <td style={{ color: "var(--admin-muted)" }}>
                        {supplier.phone ?? "—"}
                        {supplier.email ? <span className="admin-cell-sub">{supplier.email}</span> : null}
                      </td>
                      <td className="numeric">{spend.expenseCount}</td>
                      <td className="numeric">{formatMoney(spend.totalCents)}</td>
                      <td>
                        {supplier.is_active ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral">Archivado</Badge>}
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <SupplierDialog
                            triggerLabel="Editar"
                            triggerVariant="secondary"
                            supplier={{
                              id: supplier.id,
                              name: supplier.name,
                              company: supplier.company,
                              phone: supplier.phone,
                              email: supplier.email,
                              address: supplier.address,
                              notes: supplier.notes,
                            }}
                          />
                          <ConfirmAction
                            action={setSupplierActiveAction}
                            fields={{ id: supplier.id, active: supplier.is_active ? "false" : "true" }}
                            triggerLabel={supplier.is_active ? "Archivar" : "Restaurar"}
                            title={supplier.is_active ? "Archivar proveedor" : "Restaurar proveedor"}
                            description={
                              supplier.is_active
                                ? `"${supplier.name}" dejará de aparecer al registrar gastos. Los ${spend.expenseCount} gasto(s) ya registrados se conservan.`
                                : `"${supplier.name}" volverá a estar disponible al registrar gastos.`
                            }
                            confirmLabel={supplier.is_active ? "Archivar" : "Restaurar"}
                            variant={supplier.is_active ? "danger" : "primary"}
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
            title={sp.q ? "Sin resultados" : "Aún no tienes proveedores"}
            description={
              sp.q
                ? "Prueba con otro nombre o empresa."
                : "Registra a quién le compras para poder asociar gastos y llevar el control de lo que gastas con cada uno."
            }
          />
        )}
        <Pagination
          basePath="/admin/proveedores"
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
