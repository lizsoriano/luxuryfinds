import Link from "next/link";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ProductCard } from "../../../components/ui/ProductCard";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getCatalogProducts } from "../../../lib/supabase/catalog";

export const dynamic = "force-dynamic";

export default async function ImmediatePage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const sp = await searchParams;
  const requested = Number(sp.pagina);
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  let result;
  try {
    result = await getCatalogProducts({ catalogType: "IMMEDIATE", page });
    if (page > result.totalPages) result = await getCatalogProducts({ catalogType: "IMMEDIATE", page: result.totalPages });
  } catch { result = null; }
  const current = result?.page ?? 1;
  const totalPages = result?.totalPages ?? 1;
  const start = Math.min(Math.max(1, current - 1), Math.max(1, totalPages - 3));
  const numbers = Array.from({ length: Math.min(4, totalPages) }, (_, index) => start + index);
  const href = (target: number) => target === 1 ? "/entrega-inmediata" : `/entrega-inmediata?pagina=${target}`;
  return <main className="catalog-page"><div className="shell">
    <PageHeader eyebrow="LISTO PARA TI" title={<>Entrega <em>inmediata.</em></>} description="Productos disponibles físicamente en La Paz." />
    {!result ? <EmptyState title="No pudimos cargar los productos" description="Intenta de nuevo en unos minutos." /> : result.products.length ? <>
      <p className="catalog-result-count">{result.total} productos · Página {current} de {totalPages}</p>
      <div className="product-grid">{result.products.map(product => <ProductCard product={product} key={product.id} />)}</div>
      {totalPages > 1 && <nav className="catalog-pagination" aria-label="Páginas de entrega inmediata">
        {current > 1 && <Link href={href(current - 1)} className="catalog-pagination-arrow" aria-label="Página anterior">←</Link>}
        <span className="catalog-pagination-numbers">{numbers.map(number => <Link href={href(number)} key={number} className={number === current ? "active" : undefined} aria-current={number === current ? "page" : undefined} aria-label={`Página ${number}`}>{number}</Link>)}</span>
        {current < totalPages && <Link href={href(current + 1)} className="catalog-pagination-arrow" aria-label="Página siguiente">→</Link>}
      </nav>}
    </> : <EmptyState title="No hay productos para entrega inmediata" description="Vuelve pronto para ver nuevas disponibilidades." />}
  </div></main>;
}
