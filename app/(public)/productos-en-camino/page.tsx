import Link from "next/link";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { formatMoneyCompact } from "../../../lib/format";
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
          : <div className="product-grid incoming-catalog-grid">{result.products.map((product) => (
            <article className="product-card-plain incoming-catalog-card" key={product.id}>
              <div className="product-photo">
                {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" />
                  : <span className="product-photo-fallback">{product.brand}</span>}
              </div>
              <h2 className="product-plain-name">{product.name}</h2>
              <div className="incoming-card-meta">
                <span className="incoming-card-status"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10" strokeLinejoin="round" /></svg>En camino</span>
                {product.variant && product.variant.trim().toLocaleLowerCase("es") !== "único" && <span className="incoming-card-variant">{product.variant}</span>}
              </div>
              <p className="product-plain-price">{formatMoneyCompact(product.priceCents)}</p>
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
