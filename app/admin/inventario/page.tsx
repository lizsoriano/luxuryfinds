import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatCard } from "../../../components/ui/StatCard";
import { formatMoneyCompact } from "../../../lib/format";
import {
  getInventoryKpis,
  getStockFor,
  listActiveCategories,
  listProducts,
} from "../../../lib/supabase/admin-catalog";
import { InventoryTable } from "./InventoryTable";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; categoria?: string; estado?: string; archivados?: string; page?: string };

const FILTERS = [
  { value: "all", label: "Todos" },
  { value: "out", label: "Sin stock" },
  { value: "low", label: "Stock bajo" },
] as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const stockFilter = (["all", "out", "low"] as const).includes(sp.estado as "all")
    ? ((sp.estado ?? "all") as "all" | "out" | "low")
    : "all";
  const includeArchived = sp.archivados === "1";

  let result;
  let kpis;
  let categories: Array<{ id: string; name: string }> = [];
  try {
    [result, kpis, categories] = await Promise.all([
      listProducts({
        search: sp.q?.trim() || undefined,
        categoryId: sp.categoria || undefined,
        stockFilter,
        includeArchived,
        page: Number(sp.page) || 1,
      }),
      getInventoryKpis(),
      listActiveCategories(),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="OPERACIÓN" title="Inventario" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar el inventario: {error instanceof Error ? error.message : "error desconocido"}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            El stock se calcula con la vista <code>variant_stock</code>. Si acabas de aplicar la migración 002,
            recarga la página.
          </p>
        </Card>
      </main>
    );
  }

  // One row per variant: that is the level at which stock, cost and SKU exist.
  const variantRows = result.products.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  );
  const stock = await getStockFor(variantRows.map((row) => row.variant.id));

  const buildFilterHref = (value: string) => {
    const search = new URLSearchParams();
    if (sp.q) search.set("q", sp.q);
    if (sp.categoria) search.set("categoria", sp.categoria);
    if (includeArchived) search.set("archivados", "1");
    if (value !== "all") search.set("estado", value);
    const query = search.toString();
    return query ? `/admin/inventario?${query}` : "/admin/inventario";
  };

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="OPERACIÓN"
        title="Inventario"
        description="Las existencias salen del libro de movimientos (entradas, apartados, ventas y entregas), no de un campo editable."
        action={
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button href="/admin/categorias" variant="secondary" size="small">
              Categorías
            </Button>
            <Button href="/admin/productos/nuevo" size="small">
              Crear producto <span aria-hidden>＋</span>
            </Button>
          </span>
        }
      />

      <section className="admin-stats">
        <StatCard
          label="REFERENCIAS"
          value={String(kpis.referenceCount)}
          note={`${kpis.productCount} producto(s) activo(s)`}
        />
        <StatCard
          label="COSTO TOTAL DEL INVENTARIO"
          value={formatMoneyCompact(kpis.costTotalCents)}
          note={`Valor a precio de venta: ${formatMoneyCompact(kpis.retailTotalCents)}`}
          tone="rose"
        />
        <StatCard label="SIN STOCK" value={String(kpis.outOfStock)} note="Referencias en cero" tone="warning" />
        <StatCard label="STOCK BAJO" value={String(kpis.lowStock)} note="Por debajo del mínimo definido" />
      </section>

      {kpis.capped ? (
        <div className="admin-notice">
          <strong>Los totales se calcularon sobre las primeras 2000 referencias.</strong>
          El inventario superó ese límite; los indicadores de arriba son parciales.
        </div>
      ) : null}

      <FilterForm action="/admin/inventario">
        <label className="field admin-toolbar-grow" htmlFor="inventory-search">
          <span>Buscar</span>
          <input
            id="inventory-search"
            className="input"
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Nombre o código…"
          />
        </label>
        <label className="field" htmlFor="inventory-category">
          <span>Categoría</span>
          <select id="inventory-category" className="input select" name="categoria" defaultValue={sp.categoria ?? ""}>
            <option value="">Todas</option>
            {categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="estado" value={stockFilter} />
        <label className="admin-switch" htmlFor="inventory-archived">
          <input id="inventory-archived" type="checkbox" name="archivados" value="1" defaultChecked={includeArchived} />
          <span>Incluir archivados</span>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Buscar
          </Button>
        </div>
      </FilterForm>

      <div className="admin-chip-row" style={{ marginBottom: 16 }}>
        {FILTERS.map((filter) => (
          <a
            className={`admin-chip${stockFilter === filter.value ? " active" : ""}`}
            href={buildFilterHref(filter.value)}
            key={filter.value}
          >
            {filter.label}
          </a>
        ))}
      </div>

      <Card className="admin-panel">
        {variantRows.length ? (
          <InventoryTable
            rows={variantRows.map(({ product, variant }) => ({
              productId: product.id,
              productName: product.name,
              imageUrl: product.imageUrl,
              categoryName: product.categoryName,
              isActive: product.is_active,
              isPublic: product.is_public,
              variantId: variant.id,
              variantName: variant.name,
              sku: variant.sku,
              unitLabel: variant.unit_label,
              available: stock.get(variant.id) ?? 0,
              minimum: Number(variant.min_quantity ?? 0),
              priceCents: Number(variant.price_cents ?? 0),
              costCents: Number(variant.cost_cents ?? 0),
            }))}
            storageKey={`/admin/inventario?${new URLSearchParams({
              q: sp.q?.trim() ?? "",
              categoria: sp.categoria ?? "",
              archivados: includeArchived ? "1" : "",
              estado: stockFilter,
            }).toString()}`}
            filter={{
              search: sp.q?.trim() || undefined,
              categoryId: sp.categoria || undefined,
              includeArchived,
              stockFilter,
            }}
            totalResults={result.total}
            morePages={result.total > result.pageSize}
            categories={categories}
          />
        ) : (
          <EmptyState
            title={stockFilter === "all" ? "Aún no tienes productos en inventario" : "Ninguna referencia coincide"}
            description={
              stockFilter === "all"
                ? "Crea un producto para empezar a llevar existencias."
                : "Cambia el filtro o la búsqueda para ver otras referencias."
            }
            href="/admin/productos/nuevo"
            action="Crear producto"
          />
        )}
        <Pagination
          basePath="/admin/inventario"
          params={{ q: sp.q, categoria: sp.categoria, estado: sp.estado, archivados: sp.archivados }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hasNextPage={result.hasNextPage}
        />
      </Card>

      {stockFilter !== "all" ? (
        <p className="admin-hint" style={{ marginTop: 12 }}>
          Los filtros de stock se aplican sobre la página actual del listado; la paginación sigue contando el
          total sin filtrar. En cambio, “Seleccionar todos los resultados” (acciones masivas) sí aplica el filtro de
          stock en todas las páginas.
        </p>
      ) : null}
    </main>
  );
}
