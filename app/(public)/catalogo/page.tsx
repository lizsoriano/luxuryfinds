import { EmptyState } from "../../../components/ui/EmptyState";
import { ProductCard } from "../../../components/ui/ProductCard";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getCatalogProducts, type CatalogProduct } from "../../../lib/supabase/catalog";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  let products: CatalogProduct[];
  let error = false;
  try { products = await getCatalogProducts(); }
  catch { products = []; error = true; }

  return <main className="catalog-page"><div className="shell"><PageHeader eyebrow="UNA SELECCIÓN ESPECIAL" title={<>Encuentra tu próximo <em>favorito.</em></>} description="Moda, belleza y productos especiales disponibles para entrega inmediata o por pedido." /><div className="catalog-toolbar"><div className="filter-tabs" aria-label="Filtrar catálogo"><button className="active" type="button">Todo</button><button type="button">Entrega inmediata</button><button type="button">Por pedido</button></div><label className="catalog-sort"><span>Ordenar por</span><select defaultValue="recommended"><option value="recommended">Recomendados</option><option value="price">Precio: menor a mayor</option><option value="recent">Más recientes</option></select></label></div>{error ? <EmptyState title="No pudimos cargar el catálogo" description="Intenta de nuevo en unos minutos." /> : products.length ? <div className="product-grid">{products.map((product) => <ProductCard product={product} key={product.id} />)}</div> : <EmptyState title="Próximamente encontrarás algo especial" description="Todavía no hay productos publicados en el catálogo." />}</div></main>;
}
