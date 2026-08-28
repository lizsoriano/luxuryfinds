import { EmptyState } from "../../../components/ui/EmptyState";
import { ProductCard } from "../../../components/ui/ProductCard";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getCatalogProducts, type CatalogProduct } from "../../../lib/supabase/catalog";

export const dynamic = "force-dynamic";

export default async function ImmediatePage() {
  let products: CatalogProduct[];
  let error = false;
  try { products = await getCatalogProducts("IMMEDIATE"); }
  catch { products = []; error = true; }
  return <main className="catalog-page"><div className="shell"><PageHeader eyebrow="LISTO PARA TI" title={<>Entrega <em>inmediata.</em></>} description="Productos disponibles físicamente en La Paz."/>{error ? <EmptyState title="No pudimos cargar los productos" description="Intenta de nuevo en unos minutos."/> : products.length ? <div className="product-grid">{products.map((product)=><ProductCard product={product} key={product.id}/>)}</div> : <EmptyState title="No hay productos para entrega inmediata" description="Vuelve pronto para ver nuevas disponibilidades."/>}</div></main>;
}
