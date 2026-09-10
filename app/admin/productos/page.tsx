import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { formatMoney, formatQuantity } from "../../../lib/format";
import { listActiveCategories, listProducts } from "../../../lib/supabase/admin-catalog";
import { PageHeader } from "../../../components/ui/PageHeader";
import { setProductActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; categoria?: string; archivados?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const includeArchived = sp.archivados === "1";

  let result;
  let categories: Array<{ id: string; name: string }> = [];
  try {
    [result, categories] = await Promise.all([
      listProducts({
        search: sp.q?.trim() || undefined,
        categoryId: sp.categoria || undefined,
        includeArchived,
        page: Number(sp.page) || 1,
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

      <FilterForm action="/admin/productos">
        <label className="field admin-toolbar-grow" htmlFor="products-search">
          <span>Buscar</span>
          <input
            id="products-search"
            className="input"
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Nombre o código interno…"
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

      <Card className="admin-panel">
        {result.products.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Tipo</th>
                  <th className="numeric">Stock</th>
                  <th className="numeric">Precio</th>
                  <th>Catálogo</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {result.products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <div className="admin-cell-main">
                        {product.imageUrl ? (
                          <img className="admin-thumb" src={product.imageUrl} alt="" />
                        ) : (
                          <span className="admin-thumb admin-thumb-fallback" aria-hidden>
                            LF
                          </span>
                        )}
                        <span>
                          <strong>{product.name}</strong>
                          <span className="admin-cell-sub">
                            {product.internal_code ?? product.variants[0]?.sku ?? "Sin código"} ·{" "}
                            {product.variants.length} variante(s)
                          </span>
                        </span>
                      </div>
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{product.categoryName ?? "—"}</td>
                    <td>
                      <Badge tone="neutral">
                        {product.product_kind === "VARIANTS"
                          ? "Variantes"
                          : product.product_kind === "MEASURED"
                            ? "Medidas"
                            : "Básico"}
                      </Badge>
                    </td>
                    <td className="numeric">{formatQuantity(product.stock, product.variants[0]?.unit_label)}</td>
                    <td className="numeric">{formatMoney(product.priceCents)}</td>
                    <td>
                      {!product.is_active ? (
                        <Badge tone="neutral">Archivado</Badge>
                      ) : product.is_public ? (
                        <Badge tone="success">Visible</Badge>
                      ) : (
                        <Badge tone="warning">Oculto</Badge>
                      )}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <Button href={`/admin/productos/${product.id}`} variant="secondary" size="small">
                          Editar
                        </Button>
                        <ConfirmAction
                          action={setProductActiveAction}
                          fields={{ id: product.id, active: product.is_active ? "false" : "true" }}
                          triggerLabel={product.is_active ? "Archivar" : "Restaurar"}
                          title={product.is_active ? "Archivar producto" : "Restaurar producto"}
                          description={
                            product.is_active
                              ? `"${product.name}" saldrá del catálogo público y del punto de venta. Su historial de inventario y las ventas ya registradas se conservan.`
                              : `"${product.name}" volverá al inventario. Tendrás que marcarlo de nuevo como visible si quieres publicarlo.`
                          }
                          confirmLabel={product.is_active ? "Archivar" : "Restaurar"}
                          variant={product.is_active ? "danger" : "primary"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          params={{ q: sp.q, categoria: sp.categoria, archivados: sp.archivados }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hasNextPage={result.hasNextPage}
        />
      </Card>
    </main>
  );
}
