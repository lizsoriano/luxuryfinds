import Link from "next/link";
import { requireAdminActor } from "../../../lib/supabase/business";
import { listIncomingItems } from "../../../lib/supabase/incoming-reservations";
import { listClientOptions } from "../../../lib/supabase/admin-contacts";
import { OfferForm, ReservationForm } from "./IncomingForms";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ pagina?: string; q?: string }> }) {
  await requireAdminActor(); const sp = await searchParams; const page = Math.max(1, Math.floor(Number(sp.pagina) || 1));
  let result; let clients;
  try { [result, clients] = await Promise.all([listIncomingItems(page, sp.q), listClientOptions()]); }
  catch (error) { return <main className="admin-content"><h1>Próximamente</h1><p className="form-message form-error" role="alert">{error instanceof Error ? error.message : "No se pudo cargar la mercancía."}</p></main>; }
  const href = (target: number) => `/admin/proximamente?${new URLSearchParams({ pagina: String(target), q: sp.q ?? "" })}`;
  return <main className="admin-content"><div className="staff-heading"><div><h1>Próximamente</h1><p className="admin-hint">Publica mercancía ya comprada que todavía no llega a La Paz y registra apartados, incluso si ya va en un embarque.</p></div><Link className="button button-secondary" href="/admin/apartados">Ver apartados</Link></div>
    <form method="get" action="/admin/proximamente" className="staff-search"><label className="sr-only" htmlFor="incoming-search">Buscar artículo</label><input className="input" id="incoming-search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar artículo…" /><button className="button button-secondary">Buscar</button></form>
    {result.error && <p className="form-message form-error" role="alert">{result.error}</p>}
    <div className="incoming-admin-grid">{result.items.map((item) => <section className="admin-panel incoming-admin-card" key={item.purchase_item_id}><div className="incoming-item-heading">{item.photoUrl && <img src={item.photoUrl} alt={item.name} loading="lazy" />}<div><h2>{item.name}</h2><p>{item.variant_label} · {item.purchase_number}</p><p><strong>{item.available_quantity} disponibles</strong> · {item.reserved_pending_quantity} apartadas por llegar · {item.received_quantity} recibidas</p></div></div><OfferForm item={item} />{item.unit_price_cents && item.available_quantity > 0 ? <ReservationForm key={`${item.purchase_item_id}-${item.available_quantity}`} item={item} clients={clients} requestId={crypto.randomUUID()} /> : <p className="admin-hint">{!item.unit_price_cents ? "Guarda el precio de venta para poder apartar." : "No quedan piezas por llegar disponibles para apartar."}</p>}</section>)}</div>
    {!result.error && !result.items.length && <p>No hay artículos de compras confirmadas para mostrar.</p>}<div className="admin-form-actions">{page > 1 && <Link href={href(page - 1)}>Anterior</Link>}{result.hasNext && <Link href={href(page + 1)}>Siguiente</Link>}</div>
  </main>;
}
