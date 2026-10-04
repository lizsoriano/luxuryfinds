import Link from "next/link";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatMoney } from "../../../lib/format";
import { getIncomingProducts } from "../../../lib/supabase/catalog";

export const dynamic = "force-dynamic";

export default async function IncomingProductsPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const sp = await searchParams;
  const requestedPage = Number(sp.pagina);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  let result;
  try {
    result = await getIncomingProducts(page);
    if (page > result.totalPages) result = await getIncomingProducts(result.totalPages);
  } catch {
    result = null;
  }
  const currentPage = result ? Math.min(page, result.totalPages) : page;

  return (
    <main className="catalog-page">
      <div className="shell">
        <PageHeader eyebrow="PRÓXIMAMENTE EN LA PAZ" title={<>Productos <em>en camino.</em></>}
          description="Conoce nuestras próximas llegadas. Estos productos todavía no están disponibles para entrega inmediata." />
        {!result ? <EmptyState title="No pudimos cargar las próximas llegadas" description="Intenta de nuevo en unos minutos." />
          : !result.products.length ? <EmptyState title="No hay productos en camino publicados" description="Vuelve pronto para descubrir nuestras próximas llegadas." />
          : <div className="product-grid">{result.products.map((product) => (
            <article className="product-card-plain" key={product.id}>
              <div className="product-photo">
                {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" />
                  : <span className="product-photo-fallback">{product.brand}</span>}
              </div>
              <p className="micro-label">En camino · Próximamente en La Paz</p>
              <p className="product-plain-name">{product.name}</p>
              <p>{product.variant}</p>
              <p className="product-plain-price">{formatMoney(product.priceCents)}</p>
            </article>
          ))}</div>}
        {result && result.totalPages > 1 && <nav aria-label="Páginas de productos en camino" className="catalog-pagination">
          {currentPage > 1 && <Link href={`/productos-en-camino?pagina=${currentPage - 1}`}>Anterior</Link>}
          <span>Página {currentPage} de {result.totalPages}</span>
          {currentPage < result.totalPages && <Link href={`/productos-en-camino?pagina=${currentPage + 1}`}>Siguiente</Link>}
        </nav>}
      </div>
    </main>
  );
}
