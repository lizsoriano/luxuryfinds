import { notFound } from "next/navigation";
import { getPublicTracking } from "../../../lib/supabase/sales-tracking";
import { STAGE_LABELS, STAGE_TONES } from "../../../lib/sales-feed";
import { Badge } from "../../../components/ui/Badge";
import { formatDate } from "../../../lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Seguimiento de tu compra", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tracking = await getPublicTracking(token);
  if (!tracking) notFound();
  return <main className="tracking-page"><header><span className="micro-label">LUXURY FINDS</span><h1>Seguimiento de tu compra</h1><p>{tracking.firstName ? `Hola, ${tracking.firstName}. ` : ""}Aquí puedes consultar el estado de tus productos.</p></header>
    <section className="tracking-card"><div className="section-heading"><h2>Tu compra</h2><Badge tone={STAGE_TONES[tracking.stage]}>{STAGE_LABELS[tracking.stage]}</Badge></div><p className="admin-hint">Creada el {formatDate(tracking.createdAt)}</p><div className="sales-lines">{tracking.lines.length ? tracking.lines.map(i => <div className="sales-line" key={i.id}>{i.image ? <img src={i.image} alt="" width={64} height={64} /> : <div className="sales-image-placeholder" aria-hidden="true">◇</div>}<div><strong>{i.name}</strong>{i.variant && <p className="admin-hint">{i.variant}</p>}<p className="admin-hint">{i.quantity} {i.quantity === 1 ? "unidad" : "unidades"}</p><Badge tone={STAGE_TONES[i.stage]}>{STAGE_LABELS[i.stage]}</Badge>{i.updatedAt && <p className="admin-hint">Actualizado el {formatDate(i.updatedAt)}</p>}</div></div>) : <p>Compra de mostrador.</p>}</div></section><p className="tracking-help">Conserva este enlace para consultar el avance de tu compra.</p>
  </main>;
}
