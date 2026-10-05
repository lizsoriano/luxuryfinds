import Link from "next/link";
import { listPublicIncoming } from "../../../lib/supabase/incoming-reservations";
import { formatMoney } from "../../../lib/format";
export const dynamic = "force-dynamic";
export const metadata = { title: "Próximamente", description: "Mercancía de Luxury Finds que viene a La Paz. Apartados con atención personalizada." };
export default async function Page({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const sp = await searchParams; const page = Math.max(1, Math.floor(Number(sp.pagina) || 1));
  let result; try { result = await listPublicIncoming(page); }
  catch { return <main className="simple-page shell"><h1>Próximamente</h1><p>No pudimos cargar los próximos productos. Intenta de nuevo más tarde.</p></main>; }
  return <main className="simple-page shell"><p className="section-label">VIENEN A LA PAZ</p><h1>Próximamente</h1><p>Ya compramos estas piezas y todavía no llegan. Solicita tu apartado con atención de Luxury Finds: anticipo del 50 % y un mes para liquidar. Si no se liquida a tiempo, la pieza pasa a disponible.</p><Link className="button button-secondary" href="/como-comprar">Solicitar un apartado</Link><div className="product-grid incoming-public-grid">{result.items.map((item) => <article className="incoming-public-card" key={item.purchase_item_id}>{item.photoUrl && <img src={item.photoUrl} alt={item.name} loading="lazy" />}<h2>{item.name}</h2>{item.variant_label && <p>{item.variant_label}</p>}<strong>{formatMoney(Number(item.unit_price_cents))}</strong><p>{item.available_quantity} pieza(s) disponibles</p><p>Llegada estimada: {item.estimated_arrival ? new Date(`${item.estimated_arrival}T12:00:00-07:00`).toLocaleDateString("es-MX", { timeZone: "America/Mazatlan", dateStyle: "medium" }) : "Por confirmar"}</p></article>)}</div>{!result.items.length && <p>Por ahora no hay piezas próximas a llegar disponibles para apartar.</p>}<div className="hero-actions">{page > 1 && <Link href={`/proximamente?pagina=${page - 1}`}>Anterior</Link>}{result.hasNext && <Link href={`/proximamente?pagina=${page + 1}`}>Siguiente</Link>}</div></main>;
}
