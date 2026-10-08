import Link from "next/link";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { PageHeader } from "../../../components/ui/PageHeader";
import { SALES_FILTERS, countForFilter, resolveSalesFilter } from "../../../lib/sales-feed";
import { listSales, SALES_MIGRATION, SALES_PAGE_SIZE } from "../../../lib/supabase/sales";
import { SalesTable } from "./SalesTable";

export const dynamic = "force-dynamic";
export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const text = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const search = text("q").slice(0, 160);
  const filter = resolveSalesFilter(text("estado")).key;
  const ascending = text("orden") === "asc";
  const page = Math.max(1, Math.min(100000, Math.floor(Number(text("pagina")) || 1)));
  const href = (changes: Record<string, string>) => {
    const query = new URLSearchParams({ q: search, estado: filter, orden: ascending ? "asc" : "desc", pagina: String(page), ...changes });
    return `/admin/vender?${query}`;
  };
  let result;
  try { result = await listSales({ search, filter, ascending, page }); }
  catch (error) { return <main className="admin-content"><PageHeader title="Ventas" action={<Button href="/admin/vender/nueva">Nueva venta</Button>} /><Card className="admin-panel"><p className="form-message form-error" role="alert">No pudimos cargar las ventas: {error instanceof Error ? error.message : "Intenta nuevamente."}</p></Card></main>; }
  const pages = Math.max(1, Math.ceil(result.total / SALES_PAGE_SIZE));
  return <main className="admin-content sales-page">
    <PageHeader title={<>Ventas <span className="sales-open">{result.counts.open} abiertas</span></>} action={<Button href="/admin/vender/nueva">Nueva venta</Button>} />
    <div className="sales-shortcuts"><Link href="/admin/vender/nueva?accion=caja">Abrir caja</Link><Link href="/admin/vender/nueva?accion=gasto">Nuevo gasto</Link></div>
    {result.fallback && <p className="form-message" role="status">Vista de respaldo: las 1,000 ventas y 1,000 pedidos más recientes. Aplica {SALES_MIGRATION} para activar la lista completa.</p>}
    <Card className="admin-panel sales-list-card"><div className="sales-toolbar"><form action="/admin/vender" className="sales-search"><label htmlFor="sales-search" className="sr-only">Buscar ventas</label><input id="sales-search" name="q" placeholder="Buscar" defaultValue={search} maxLength={160} /><input type="hidden" name="estado" value={filter} /><input type="hidden" name="orden" value={ascending ? "asc" : "desc"} /><button type="submit" className="button button-secondary button-small">Buscar</button></form>
    <nav className="sales-chips" aria-label="Estado de las ventas">{SALES_FILTERS.map(f => <Link key={f.key} href={href({ estado: f.key, pagina: "1" })} className={`sales-chip ${filter === f.key ? "is-active" : ""}`} aria-current={filter === f.key ? "page" : undefined}>{f.label} <span>{countForFilter(result.counts, f.key)}</span></Link>)}</nav></div>
    {result.records.length ? <SalesTable key={`${filter}-${search}-${page}-${ascending}`} records={result.records} dateHref={href({ orden: ascending ? "desc" : "asc", pagina: "1" })} ascending={ascending} /> : <div className="sales-empty"><div className="sales-empty-icon" aria-hidden="true">↗</div><h2>{result.counts.total ? "No encontramos ventas" : "Tu próxima venta empieza aquí"}</h2><p>{result.counts.total ? "Prueba otro estado o cambia tu búsqueda." : "Tus ventas de mostrador y pedidos aparecerán juntos para que puedas darles seguimiento."}</p><Button href={result.counts.total ? "/admin/vender" : "/admin/vender/nueva"}>{result.counts.total ? "Ver todas las ventas" : "Nueva venta"}</Button></div>}
    <footer className="sales-footer"><span>Mostrando {result.records.length ? (page - 1) * SALES_PAGE_SIZE + 1 : 0}–{result.records.length ? (page - 1) * SALES_PAGE_SIZE + result.records.length : 0} ventas de {result.total}</span><nav aria-label="Páginas de ventas">{page > 1 && <Link href={href({ pagina: String(page - 1) })}>Anterior</Link>}<span>Página {page} de {pages}</span>{page < pages && <Link href={href({ pagina: String(page + 1) })}>Siguiente</Link>}</nav><Link href="/admin/ayuda">Ayuda con tus ventas</Link></footer></Card>
  </main>;
}
