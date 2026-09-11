import Link from "next/link";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ProductCard } from "../../../components/ui/ProductCard";
import {
  getCatalogProducts,
  getCatalogCategories,
  getCatalogBrands,
  type CatalogProduct,
  type CatalogSort,
  type CatalogType,
} from "../../../lib/supabase/catalog";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  categoria?: string;
  marca?: string;
  tipo?: string;
  orden?: string;
  precio_min?: string;
  precio_max?: string;
  pagina?: string;
};

function buildQuery(current: SearchParams, overrides: Partial<SearchParams>) {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  // Absolute path, not "." - /catalogo has no trailing slash, so a relative "."
  // resolves to its parent directory (the site root "/"), not the catalog page
  // itself. That silently dropped every search/filter reset onto the homepage.
  return qs ? `?${qs}` : "/catalogo";
}

const SORT_OPTIONS: { value: CatalogSort; label: string }[] = [
  { value: "recommended", label: "Recomendados" },
  { value: "bestsellers", label: "Más vendidos" },
  { value: "recent", label: "Más nuevo al más viejo" },
  { value: "price_asc", label: "Precio: menor a mayor" },
  { value: "price_desc", label: "Precio: mayor a menor" },
  { value: "name_asc", label: "A - Z" },
  { value: "name_desc", label: "Z - A" },
];

/**
 * Availability tabs filter by tipo, a brand tab by marca, a category tab by
 * categoria (slug) - all three live in the same strip. Each tab clears the
 * other two params so they stay mutually exclusive.
 *
 * "Perfumes" maps to the "Fragrances" category (642 public products), not the
 * separate "Perfume" category (only 11) - confirmed against real product
 * counts rather than guessing from the name alone.
 */
type FilterTab = { label: string; tipo?: CatalogType; marca?: string; categoria?: string };
const TYPE_TABS: FilterTab[] = [
  { label: "Todo" },
  { label: "Entrega inmediata", tipo: "IMMEDIATE" },
  { label: "Por pedido", tipo: "ON_DEMAND" },
  { label: "Sephora Favorites", marca: "Sephora Favorites" },
  { label: "Perfumes", categoria: "fragrances" },
  { label: "Blushes", categoria: "blushes" },
  { label: "Labiales", categoria: "labios" },
  { label: "Bases", categoria: "foundations" },
  { label: "Correctores", categoria: "concealers" },
];

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sort = (sp.orden as CatalogSort) || "recommended";
  const catalogType = sp.tipo === "IMMEDIATE" || sp.tipo === "ON_DEMAND" ? sp.tipo : undefined;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const minPrice = sp.precio_min ? Number(sp.precio_min) : undefined;
  const maxPrice = sp.precio_max ? Number(sp.precio_max) : undefined;

  let products: CatalogProduct[] = [];
  let hasNextPage = false;
  let error = false;
  let errorMessage = "";
  let categories: { id: string; name: string; slug: string }[] = [];
  let brands: { id: string; name: string }[] = [];

  try {
    const [result, categoryList, brandList] = await Promise.all([
      getCatalogProducts({
        catalogType,
        categorySlug: sp.categoria,
        brand: sp.marca,
        search: sp.q,
        sort,
        minPrice,
        maxPrice,
        page,
      }),
      getCatalogCategories(),
      getCatalogBrands(16),
    ]);
    products = result.products;
    hasNextPage = result.hasNextPage;
    categories = categoryList;
    brands = brandList;
  } catch (e) {
    error = true;
    errorMessage = e instanceof Error ? e.message : String(e);
    console.error("[catalogo] failed to load:", e);
  }

  const activeFilterCount = [sp.categoria, sp.marca, sp.precio_min, sp.precio_max].filter(Boolean).length;

  return (
    <main className="catalog-page">
      <div className="shell">
        <p className="catalog-breadcrumb"><Link href="/">Inicio</Link> <span aria-hidden>.</span> Catálogo</p>
        <h1 className="catalog-title">Catálogo</h1>

        <form className="catalog-search" method="get" action="/catalogo">
          {sp.categoria && <input type="hidden" name="categoria" value={sp.categoria} />}
          {sp.marca && <input type="hidden" name="marca" value={sp.marca} />}
          {catalogType && <input type="hidden" name="tipo" value={catalogType} />}
          {sort !== "recommended" && <input type="hidden" name="orden" value={sort} />}
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Busca marcas, productos..." aria-label="Buscar productos" />
          <button type="submit" aria-label="Buscar">⌕</button>
        </form>

        <div className="filter-tabs" aria-label="Filtrar por disponibilidad, marca y categoría">
          {TYPE_TABS.map((tab) => {
            const active = tab.marca
              ? sp.marca === tab.marca
              : tab.categoria
                ? sp.categoria === tab.categoria
                : !sp.marca && !sp.categoria && catalogType === tab.tipo;
            return (
              <a
                key={tab.label}
                href={buildQuery(sp, { tipo: tab.tipo, marca: tab.marca, categoria: tab.categoria, pagina: undefined })}
                className={active ? "active" : ""}
              >
                {tab.label}
              </a>
            );
          })}
        </div>

        <details className="filter-disclosure">
          <summary>Filtrar{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</summary>
          <div className="filter-panel">
            <form method="get" action="/catalogo" className="filter-panel-form">
              {sp.q && <input type="hidden" name="q" value={sp.q} />}
              {catalogType && <input type="hidden" name="tipo" value={catalogType} />}

              <div className="filter-group">
                <h3>Ordenar</h3>
                <select name="orden" defaultValue={sort}>
                  {SORT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>

              <div className="filter-group">
                <h3>Precio</h3>
                <div className="price-range">
                  <label><span>Desde</span><input type="number" name="precio_min" min={0} defaultValue={sp.precio_min ?? ""} /></label>
                  <label><span>Hasta</span><input type="number" name="precio_max" min={0} defaultValue={sp.precio_max ?? ""} /></label>
                </div>
              </div>

              {sp.categoria && <input type="hidden" name="categoria" value={sp.categoria} />}
              {sp.marca && <input type="hidden" name="marca" value={sp.marca} />}
              <button type="submit" className="button button-primary button-small">Aplicar</button>
            </form>

            <div className="filter-group">
              <h3>Categorías</h3>
              <ul className="filter-chip-list">
                <li><a className={!sp.categoria ? "active" : ""} href={buildQuery(sp, { categoria: undefined, pagina: undefined })}>Todas</a></li>
                {categories.map((cat) => (
                  <li key={cat.id}>
                    <a className={sp.categoria === cat.slug ? "active" : ""} href={buildQuery(sp, { categoria: cat.slug, pagina: undefined })}>{cat.name}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="filter-group">
              <h3>Marcas</h3>
              <ul className="filter-chip-list">
                <li><a className={!sp.marca ? "active" : ""} href={buildQuery(sp, { marca: undefined, pagina: undefined })}>Todas</a></li>
                {brands.map((b) => (
                  <li key={b.id}>
                    <a className={sp.marca === b.name ? "active" : ""} href={buildQuery(sp, { marca: b.name, pagina: undefined })}>{b.name}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>

        {error ? (
          <EmptyState title="No pudimos cargar el catálogo" description={errorMessage || "Intenta de nuevo en unos minutos."} />
        ) : products.length ? (
          <>
            <div className="product-grid">
              {products.map((product) => <ProductCard product={product} key={product.id} />)}
            </div>
            <nav className="catalog-pagination" aria-label="Paginación">
              {page > 1 && <a href={buildQuery(sp, { pagina: String(page - 1) })}>← Anterior</a>}
              <span>Página {page}</span>
              {hasNextPage && <a href={buildQuery(sp, { pagina: String(page + 1) })}>Siguiente →</a>}
            </nav>
          </>
        ) : (
          <EmptyState title="No encontramos productos" description="Intenta con otros filtros o palabras de búsqueda." />
        )}
      </div>
    </main>
  );
}
