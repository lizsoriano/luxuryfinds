import Link from "next/link";
import { formatMoney, formatQuantity } from "../../../lib/format";
import { listLaPazProducts, listStaffCategories } from "../../../lib/supabase/staff-inventory";
import { PhotoProducts } from "./PhotoProducts";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; pagina?: string };

export default async function StaffInventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const search = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.pagina) || 1);
  let categories: Array<{ id: string; name: string }> = [];
  try { categories = await listStaffCategories(); } catch { /* Category is optional. */ }

  let result;
  try {
    result = await listLaPazProducts({ search, page });
  } catch (error) {
    return (
      <main className="staff-content">
        <h1 className="staff-title">Inventario en La Paz</h1>
        <p className="form-message form-error" role="alert">
          No pudimos cargar el inventario: {error instanceof Error ? error.message : "error desconocido"}
        </p>
      </main>
    );
  }

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (target > 1) params.set("pagina", String(target));
    const query = params.toString();
    return `/empleado/inventario${query ? `?${query}` : ""}`;
  };

  return (
    <main className="staff-content">
      <div className="staff-heading">
        <div>
          <p className="staff-eyebrow">Entrega inmediata</p>
          <h1 className="staff-title">Inventario en La Paz</h1>
        </div>
        <Link className="button button-primary staff-cta" href="/empleado/inventario/nuevo">
          + Añadir producto
        </Link>
      </div>

      <PhotoProducts categories={categories} />

      <form className="staff-search" method="get" action="/empleado/inventario" role="search">
        <label htmlFor="staff-inventory-search" className="sr-only">
          Buscar producto
        </label>
        <input id="staff-inventory-search" className="input" type="search" name="q" defaultValue={search} placeholder="Buscar por nombre…" />
        <button type="submit" className="button button-secondary">
          Buscar
        </button>
      </form>

      <p className="staff-count">
        {result.total} producto(s){search ? ` con “${search}”` : ""}. Toca uno para registrar una entrada.
      </p>

      {result.products.length ? (
        <ul className="staff-list">
          {result.products.map((product) => (
            <li key={product.id}>
              <Link className="staff-card staff-product-card" href={`/empleado/inventario/${product.id}`}>
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="staff-thumb" src={product.imageUrl} alt="" loading="lazy" />
                ) : (
                  <span className="staff-thumb staff-thumb-empty" aria-hidden>
                    LF
                  </span>
                )}
                <span className="staff-card-main">
                  <strong>{product.name}</strong>
                  <small>
                    {product.categoryName ?? "Sin categoría"} · {product.variants.length} variante(s)
                    {!product.isPublic ? " · Oculto" : ""}
                  </small>
                  <span className="staff-card-meta">
                    <span className={product.stock > 0 ? "staff-stock" : "staff-stock staff-stock-out"}>
                      {formatQuantity(product.stock)} en existencia
                    </span>
                    <span className="staff-price">
                      {product.priceCents === product.maxPriceCents
                        ? formatMoney(product.priceCents)
                        : `${formatMoney(product.priceCents)} – ${formatMoney(product.maxPriceCents)}`}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="staff-empty">
          <strong>{search ? "Sin resultados" : "Todavía no hay productos en La Paz"}</strong>
          <p>{search ? "Prueba con otra palabra." : "Da de alta el primero con “Añadir producto”."}</p>
        </div>
      )}

      {result.page > 1 || result.hasNextPage ? (
        <nav className="staff-pagination" aria-label="Páginas">
          {result.page > 1 ? (
            <Link className="button button-secondary" href={pageHref(result.page - 1)}>
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span>Página {result.page}</span>
          {result.hasNextPage ? (
            <Link className="button button-secondary" href={pageHref(result.page + 1)}>
              Siguiente →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
