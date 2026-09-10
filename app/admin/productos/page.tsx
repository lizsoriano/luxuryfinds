import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { listActiveCategories, listProducts, type ProductSort } from "../../../lib/supabase/admin-catalog";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ProductsTable } from "./ProductsTable";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  categoria?: string;
  archivados?: string;
  page?: string;
  orden?: string;
};

const SORT_OPTIONS: Array<{ value: ProductSort; label: string }> = [
  { value: "recent", label: "Más nuevo" },
  { value: "oldest", label: "Más antiguo" },
  { value: "name_asc", label: "Nombre A-Z" },
  { value: "name_desc", label: "Nombre Z-A" },
];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const includeArchived = sp.archivados === "1";
  const sort: ProductSort = SORT_OPTIONS.some((option) => option.value === sp.orden)
    ? (sp.orden as ProductSort)
    : "recent";

  let result;
  let categories: Array<{ id: string; name: string }> = [];
  try {
    [result, categories] = await Promise.all([
      listProducts({
        search: sp.q?.trim() || undefined,
        categoryId: sp.categoria || undefined,
        includeArchived,
        page: Number(sp.page) || 1,
        sort,
      }),
      listActiveCategories(),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="INVENTARIO" title="Productos" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los productos: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="INVENTARIO"
        title="Productos"
        description="Todo lo que vendes: catálogo por pedido, entrega inmediata y venta directa comparten este mismo listado."
        action={
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Button href="/admin/categorias" variant="secondary" size="small">
              Categorías
            </Button>
            <a
              href={`/admin/productos/export?${new URLSearchParams({
                ...(sp.q ? { q: sp.q } : {}),
                ...(sp.categoria ? { categoria: sp.categoria } : {}),
                ...(includeArchived ? { archivados: "1" } : {}),
              }).toString()}`}
              className="button button-secondary button-small"
            >
              Exportar
            </a>
            <span className="admin-soon-chip" title="Importar productos desde Excel — próximamente">
              Importar
            </span>
            <span className="admin-soon-chip" title="Generar productos con IA — próximamente">
              ✨ Agregar con IA
            </span>
            <Button href="/admin/productos/nuevo" size="small">
              Agregar producto <span aria-hidden>＋</span>
            </Button>
          </span>
        }
      />

      <FilterForm action="/admin/productos">
        <label className="field admin-toolbar-grow" htmlFor="products-search">
          <span>Buscar</span>
          <input
            id="products-search"
            className="input"
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Nombre, SKU o código interno…"
          />
        </label>
        <label className="field" htmlFor="products-category">
          <span>Categoría</span>
          <select id="products-category" className="input select" name="categoria" defaultValue={sp.categoria ?? ""}>
            <option value="">Todas</option>
            {categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="products-sort">
          <span>Ordenar</span>
          <select id="products-sort" className="input select" name="orden" defaultValue={sort}>
            {SORT_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-switch" htmlFor="products-archived">
          <input
            id="products-archived"
            type="checkbox"
            name="archivados"
            value="1"
            defaultChecked={includeArchived}
          />
          <span>Incluir archivados</span>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Buscar
          </Button>
        </div>
      </FilterForm>

      <p className="admin-result-count">
        {result.total} producto{result.total === 1 ? "" : "s"}
      </p>

      <Card className="admin-panel">
        {result.products.length ? (
          <ProductsTable products={result.products} />
        ) : (
          <EmptyState
            title={sp.q ? "Sin resultados" : "Aún no tienes productos"}
            description={
              sp.q
                ? "Prueba con otro nombre o código."
                : "Crea tu primer producto para que aparezca en Inventario, en Vender y —si lo marcas visible— en el catálogo público."
            }
            href="/admin/productos/nuevo"
            action="Crear producto"
          />
        )}
        <Pagination
          basePath="/admin/productos"
          params={{ q: sp.q, categoria: sp.categoria, archivados: sp.archivados, orden: sp.orden }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hasNextPage={result.hasNextPage}
        />
      </Card>
    </main>
  );
}
