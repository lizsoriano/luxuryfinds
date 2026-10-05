import Link from "next/link";

import { listLaPazProducts, listStaffCategories } from "../../../lib/supabase/staff-inventory";
import { PhotoProducts } from "./PhotoProducts";
import { requireStaffActor } from "../../../lib/supabase/business";
import { InventoryRows } from "./InventoryRows";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; pagina?: string };

export default async function StaffInventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireStaffActor();
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
      <main className="staff-content staff-inventory-content">
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
    <main className="staff-content staff-inventory-content">
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

      <h2 id="staff-saved-products" className="staff-saved-title">Productos guardados</h2>
      <p className="staff-count">
        {result.total} producto(s){search ? ` con “${search}”` : ""}. Edita existencia y precio directamente en la fila.
      </p>

      {result.products.length ? (
        <InventoryRows products={result.products} actorId={actor.id} categories={categories} />
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
