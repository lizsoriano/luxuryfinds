import Link from "next/link";
import { InventoryPagination } from "./InventoryPagination";

import { listLaPazProducts, listStaffBrands, listStaffCategories } from "../../../lib/supabase/staff-inventory";
import { StaffInventoryWorkspace } from "./StaffInventoryWorkspace";
import { requireStaffActor } from "../../../lib/supabase/business";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; pagina?: string };

export default async function StaffInventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireStaffActor();
  const sp = await searchParams;
  const search = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.pagina) || 1);
  type Option = { id: string; name: string };
  const [categories, brands] = await Promise.all([
    listStaffCategories().catch((): Option[] => []), // Category is optional.
    listStaffBrands().catch((): Option[] => []), // Brand is optional too.
  ]);

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

      <StaffInventoryWorkspace products={result.products} total={result.total} search={search} actorId={actor.id} categories={categories} brands={brands}>

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
      </StaffInventoryWorkspace>

      <InventoryPagination page={result.page} totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))} search={search} />
    </main>
  );
}
