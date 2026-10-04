import { FilterForm } from "../../../../components/admin/FilterForm";
import { Pagination } from "../../../../components/admin/Pagination";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { formatDate, formatMoney, initialsOf } from "../../../../lib/format";
import { listSupplierOptions } from "../../../../lib/supabase/admin-contacts";
import {
  assignmentUnavailableMessage,
  listConfirmedPurchaseOptions,
  listPendingPurchaseItems,
  type PendingItemsResult,
} from "../../../../lib/supabase/admin-purchases";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; purchase?: string; shopper?: string; stock?: string; page?: string };

const STOCK_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "available", label: "Con piezas disponibles" },
  { value: "assigned", label: "Todo asignado" },
];

function Header() {
  return (
    <PageHeader
      eyebrow="COMPRAS CON SHOPPER"
      title="Comprados pendientes de envío"
      description="Todo lo que ya compró tu shopper y todavía no se envía: cuántas piezas compraste, cuántas ya asignaste a clientas y cuántas siguen disponibles."
      action={
        <Button href="/admin/compras" variant="secondary" size="small">
          Volver a compras
        </Button>
      }
    />
  );
}

export default async function PendingPurchaseItemsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const stock = STOCK_OPTIONS.some((option) => option.value === sp.stock) ? (sp.stock ?? "") : "";

  let result: PendingItemsResult;
  let purchases: Array<{ id: string; label: string }> = [];
  let shoppers: Array<{ id: string; label: string }> = [];
  try {
    [result, purchases, shoppers] = await Promise.all([
      listPendingPurchaseItems({
        search: sp.q,
        purchaseId: sp.purchase || undefined,
        supplierId: sp.shopper || undefined,
        stock,
        page: Number(sp.page) || 1,
      }),
      listConfirmedPurchaseOptions(),
      listSupplierOptions().catch(() => []),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <Header />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los artículos: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  const notice = assignmentUnavailableMessage(result.state);
  if (notice) {
    return (
      <main className="admin-content">
        <Header />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            {notice}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            {result.state === "missing-010"
              ? "Son dos archivos SQL que se corren una sola vez, en ese orden, en el editor SQL de Supabase: el primero crea las compras con shopper y el segundo las asignaciones a clientas."
              : "Es un archivo SQL que se corre una sola vez en el editor SQL de Supabase. Crea las asignaciones a clientas y el conteo de piezas disponibles."}{" "}
            Hasta entonces esta lista no se puede mostrar; el resto del panel funciona igual.
          </p>
        </Card>
      </main>
    );
  }

  const filtered = Boolean(sp.q || sp.purchase || sp.shopper || stock);

  return (
    <main className="admin-content">
      <Header />

      <FilterForm action="/admin/compras/pendientes">
        <label className="field admin-toolbar-grow" htmlFor="pending-search">
          <span>Buscar</span>
          <input id="pending-search" className="input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Nombre del producto…" />
        </label>
        <label className="field" htmlFor="pending-purchase">
          <span>Compra</span>
          <select id="pending-purchase" className="input" name="purchase" defaultValue={sp.purchase ?? ""}>
            <option value="">Todas</option>
            {purchases.map((purchase) => (
              <option key={purchase.id} value={purchase.id}>
                {purchase.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="pending-shopper">
          <span>Shopper</span>
          <select id="pending-shopper" className="input" name="shopper" defaultValue={sp.shopper ?? ""}>
            <option value="">Todos</option>
            {shoppers.map((shopper) => (
              <option key={shopper.id} value={shopper.id}>
                {shopper.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="pending-stock">
          <span>Piezas</span>
          <select id="pending-stock" className="input" name="stock" defaultValue={stock}>
            {STOCK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Filtrar
          </Button>
        </div>
      </FilterForm>

      <Card className="admin-panel">
        {result.items.length ? (
          <ul className="assign-list pending-list">
            {result.items.map((item) => (
              <li key={item.id} className="assign-item">
                <div className="assign-item-head">
                  {item.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="shopper-item-thumb" src={item.photoUrl} alt="" />
                  ) : (
                    <span className="shopper-item-thumb admin-thumb-fallback" aria-hidden>
                      {initialsOf(item.name)}
                    </span>
                  )}
                  <div className="shopper-item-main">
                    <strong>{item.name}</strong>
                    <small>
                      {item.variant_label ? `${item.variant_label} · ` : ""}
                      {item.store_name}
                    </small>
                    <small>
                      {item.purchase_number} · {item.supplierName} · {formatDate(item.purchase_date)}
                    </small>
                    <span className="shopper-badges">
                      {item.available > 0 ? (
                        <Badge tone="rose">{item.available} disponible(s)</Badge>
                      ) : (
                        <Badge tone="success">Todo asignado</Badge>
                      )}
                    </span>
                  </div>
                  <Button href={`/admin/compras/${item.purchase_id}#articulo-${item.id}`} variant={item.available > 0 ? "primary" : "secondary"} size="small">
                    {item.available > 0 ? "Asignar" : "Ver compra"}
                  </Button>
                </div>
                <dl className="assign-counts">
                  <div>
                    <dt>Comprado</dt>
                    <dd>{item.purchased}</dd>
                  </div>
                  <div>
                    <dt>Asignado</dt>
                    <dd>{item.assigned}</dd>
                  </div>
                  <div className={item.available > 0 ? "assign-counts-strong" : undefined}>
                    <dt>Disponible</dt>
                    <dd>{item.available}</dd>
                  </div>
                  <div>
                    <dt>Costo c/u</dt>
                    <dd>{item.unit_cost_mxn_cents !== null ? formatMoney(item.unit_cost_mxn_cents) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Costo línea</dt>
                    <dd>{item.line_cost_mxn_cents !== null ? formatMoney(item.line_cost_mxn_cents) : "—"}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={filtered ? "Sin resultados" : "Nada pendiente de envío"}
            description={
              filtered
                ? "Prueba con otro nombre, compra, shopper o filtro de piezas."
                : "Cuando confirmes una compra con shopper, sus artículos aparecen aquí hasta que se envíen."
            }
            href={filtered ? undefined : "/admin/compras"}
            action={filtered ? undefined : "Ir a compras"}
          />
        )}
        <Pagination
          basePath="/admin/compras/pendientes"
          params={{ q: sp.q, purchase: sp.purchase, shopper: sp.shopper, stock: stock || undefined }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hasNextPage={result.hasNextPage}
        />
        <p className="admin-hint" style={{ marginTop: 12 }}>
          Disponible = comprado − asignado a clientas (asignaciones activas). Costo puesto en tienda, sin paquetería. Para
          asignar, abre la compra y usa <strong>Asignar</strong> en el artículo.
        </p>
      </Card>
    </main>
  );
}
