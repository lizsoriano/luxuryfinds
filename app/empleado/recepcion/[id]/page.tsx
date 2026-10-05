import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffShipment } from "../../../../lib/supabase/staff-shipments";
import { requireStaffActor } from "../../../../lib/supabase/business";
import { ReceiveForm } from "../ReceiveForm";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffActor();
  const { id } = await params;
  let detail;
  try { detail = await getStaffShipment(id); } catch (error) { return <main className="staff-content"><h1>Recepción</h1><p className="form-message form-error" role="alert">{error instanceof Error ? error.message : "No se pudo cargar el embarque."}</p></main>; }
  if (!detail) notFound();
  const canReceive = ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(detail.shipment.status);
  return <main className="staff-content"><Link href="/empleado/recepcion">← Embarques</Link><h1 className="staff-title">{detail.shipment.shipment_number}</h1><p>{detail.shipment.carrier} · Guía: {detail.shipment.tracking_number ?? "Sin guía"} · Llegada estimada: {detail.shipment.estimated_arrival ?? "Por confirmar"}</p>
    {detail.lines.map((line) => { const pending = Number(line.expected_quantity) - Number(line.received_good_quantity) - Number(line.received_damaged_quantity) - Number(line.missing_quantity); return <section className="staff-card staff-reception-card" key={line.id}><h2>{line.name}</h2><p>{line.variant_label} · {line.assignment_id ? `${line.ticket_number ?? "Ticket"} · ${line.client_name}` : "Piezas libres"}</p><p>Esperadas {line.expected_quantity} · Buenas {line.received_good_quantity} · Dañadas {line.received_damaged_quantity} · Faltantes {line.missing_quantity}</p>{canReceive && <ReceiveForm key={`${line.id}-${pending}`} shipmentId={id} lineId={line.id} pendingQuantity={pending} />}</section>; })}
  </main>;
}
