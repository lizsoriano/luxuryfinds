import { EmptyState } from "../../../components/ui/EmptyState";
import { ProductCard } from "../../../components/ui/ProductCard";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getCatalogProducts, type CatalogProduct } from "../../../lib/supabase/catalog";

export const dynamic = "force-dynamic";

export default async function OnDemandPage() {
  let products: CatalogProduct[];
  let error = false;
  try { products = await getCatalogProducts("ON_DEMAND"); }
  catch { products = []; error = true; }
  return <main className="catalog-page"><div className="shell"><PageHeader eyebrow="LO ENCONTRAMOS PARA TI" title={<>Compras <em>por pedido.</em></>} description="Elige una pieza especial y acompaña su avance desde tu cuenta."/>{error ? <EmptyState title="No pudimos cargar los productos" description="Intenta de nuevo en unos minutos."/> : products.length ? <div className="product-grid">{products.map((product)=><ProductCard product={product} key={product.id}/>)}</div> : <EmptyState title="No hay productos por pedido" description="Vuelve pronto para descubrir nuevas piezas."/>}</div></main>;
}
