import Link from "next/link";
import { listStaffShipments } from "../../../lib/supabase/staff-shipments";
import { requireStaffActor } from "../../../lib/supabase/business";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  await requireStaffActor();
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.pagina) || 1));
  let result;
  try { result = await listStaffShipments(page); }
  catch (error) { return <main className="staff-content"><h1>Recepción de embarques</h1><p className="form-message form-error" role="alert">{error instanceof Error ? error.message : "No se pudo cargar la lista."}</p></main>; }
  return <main className="staff-content"><h1 className="staff-title">Recepción de embarques</h1><p>Cuenta las piezas que llegan a La Paz y registra fotos e incidencias.</p><ul className="staff-list">{result.shipments.map((shipment) => <li key={shipment.id}><Link className="staff-card staff-reception-card" href={`/empleado/recepcion/${shipment.id}`}><strong>{shipment.shipment_number}</strong><p>{shipment.carrier} · {shipment.tracking_number ?? "Sin guía"}</p><p>Llegada estimada: {shipment.estimated_arrival ?? "Por confirmar"}</p></Link></li>)}</ul>{!result.shipments.length && <p>No hay embarques pendientes de recibir.</p>}<div className="admin-form-actions">{page > 1 && <Link href={`/empleado/recepcion?pagina=${page - 1}`}>Anterior</Link>}{result.hasNext && <Link href={`/empleado/recepcion?pagina=${page + 1}`}>Siguiente</Link>}</div></main>;
}

