import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import {
  getCostSettings,
  listActiveCategories,
  listProducts,
  type ProductSegment,
  type ProductSort,
} from "../../../lib/supabase/admin-catalog";
import { IN_TRANSIT_MIGRATION_FILE } from "../../../lib/supabase/in-transit";
import { CostSettingsBar } from "./CostSettingsBar";
import { ProductsTable } from "./ProductsTable";
import { SEGMENTS } from "./segments";

export type ProductsSearchParams = {
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

/**
 * Body shared by the three Inventario lists (Productos / Entrega inmediata /
 * En camino). Each page is a one-liner that picks its segment.
 */
export async function ProductsListPage({
  segment,
  searchParams,
}: {
  segment: ProductSegment;
  searchParams: Promise<ProductsSearchParams>;
}) {
  const config = SEGMENTS[segment];
  const sp = await searchParams;
  const includeArchived = sp.archivados === "1";
  const sort: ProductSort = SORT_OPTIONS.some((option) => option.value === sp.orden)
    ? (sp.orden as ProductSort)
    : "recent";

  let result;
  let categories: Array<{ id: string; name: string }> = [];
  let costSettings;
  try {
    [result, categories, costSettings] = await Promise.all([
      listProducts({
        search: sp.q?.trim() || undefined,
        categoryId: sp.categoria || undefined,
        includeArchived,
        page: Number(sp.page) || 1,
        sort,
        segment,
      }),
      listActiveCategories(),
      getCostSettings(),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="INVENTARIO" title={config.title} />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los productos: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  const exportQuery = new URLSearchParams({
    segmento: segment,
    ...(sp.q ? { q: sp.q } : {}),
    ...(sp.categoria ? { categoria: sp.categoria } : {}),
    ...(includeArchived ? { archivados: "1" } : {}),
  }).toString();

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="INVENTARIO"
        title={config.title}
        description={config.description}
        action={
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Button href="/admin/categorias" variant="secondary" size="small">
              Categorías
            </Button>
            {result.unavailable ? null : (
              <a href={`/admin/productos/export?${exportQuery}`} className="button button-secondary button-small">
                Exportar
              </a>
            )}
            {result.unavailable ? null : (
              <Button href={config.newProductHref} size="small">
                Agregar producto <span aria-hidden>＋</span>
              </Button>
            )}
          </span>
        }
      />

      {result.unavailable ? (
        <div className="admin-notice" role="status">
          <strong>Esta sección se activa con una actualización de la base de datos.</strong>
          Para registrar mercancía en camino, aplica <code>{IN_TRANSIT_MIGRATION_FILE}</code> en el editor SQL de
          Supabase. No hace falta tocar nada más: al aplicarla, esta lista y el interruptor “Viene en camino” del
          formulario empiezan a funcionar solos. Mientras tanto, Productos y Entrega inmediata funcionan normalmente.
        </div>
      ) : (
        <>
          <FilterForm action={config.path}>
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

          <div className="admin-list-meta">
            <p className="admin-result-count">
              {result.total} producto{result.total === 1 ? "" : "s"}
            </p>
            <CostSettingsBar
              usdMxnRate={costSettings.usdMxnRate}
              usTaxFactor={costSettings.usTaxFactor}
              storeCostAvailable={result.storeCostAvailable}
              loadError={costSettings.error}
            />
          </div>

          <Card className="admin-panel">
            {result.products.length ? (
              <ProductsTable
                products={result.products}
                segment={segment}
                storeCost={{
                  available: result.storeCostAvailable,
                  hasRate: costSettings.usdMxnRate !== null && !costSettings.error,
                }}
                bulk={{
                  storageKey: `${config.path}?${new URLSearchParams({
                    q: sp.q?.trim() ?? "",
                    categoria: sp.categoria ?? "",
                    archivados: includeArchived ? "1" : "",
                  }).toString()}`,
                  filter: {
                    search: sp.q?.trim() || undefined,
                    categoryId: sp.categoria || undefined,
                    includeArchived,
                    segment,
                  },
                  totalResults: result.total,
                  morePages: result.total > result.pageSize,
                  categories,
                }}
              />
            ) : (
              <EmptyState
                title={sp.q || sp.categoria ? "Sin resultados" : config.emptyTitle}
                description={sp.q || sp.categoria ? "Prueba con otro nombre, código o categoría." : config.emptyDescription}
                href={config.newProductHref}
                action="Agregar producto"
              />
            )}
            <Pagination
              basePath={config.path}
              params={{ q: sp.q, categoria: sp.categoria, archivados: sp.archivados, orden: sp.orden }}
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              hasNextPage={result.hasNextPage}
            />
          </Card>
        </>
      )}
    </main>
  );
}
