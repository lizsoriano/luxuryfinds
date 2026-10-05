import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "../../../../../components/ui/Badge";
import { Button } from "../../../../../components/ui/Button";
import { Card } from "../../../../../components/ui/Card";
import { PageHeader } from "../../../../../components/ui/PageHeader";
import { StatCard } from "../../../../../components/ui/StatCard";
import { businessToday, formatDate, formatDateTime, formatMoney, initialsOf, LOGISTICS_STATUS_LABELS } from "../../../../../lib/format";
import {
  getShipmentDetail,
  listCarrierSuggestions,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
  type ShipmentDetail,
} from "../../../../../lib/supabase/admin-shipments";
import {
  CancelShipmentDialog,
  ConfirmDepartureDialog,
  EditShipmentDialog,
  LineKindBadge,
  PaidDialog,
  ReceiveAllGoodDialog,
  ReceiveLineDialog,
  RemoveLineButton,
} from "../ShipmentForms";

export const dynamic = "force-dynamic";

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2);
}

export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const today = businessToday();

  let detail: ShipmentDetail | null;
  let carriers: string[] = [];
  try {
    [detail, carriers] = await Promise.all([getShipmentDetail(id), listCarrierSuggestions()]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    return (
      <main className="admin-content">
        <PageHeader
          eyebrow="COMPRAS CON SHOPPER"
          title="Embarque"
          action={
            <Button href="/admin/compras/embarques" variant="secondary" size="small">
              Volver
            </Button>
          }
        />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            {message.includes(".sql") ? message : `No pudimos cargar el embarque: ${message}`}
          </p>
        </Card>
      </main>
    );
  }
  if (!detail) notFound();

  const { shipment, lines, receipts } = detail;
  const activeLines = lines.filter((line) => line.status === "ACTIVE");
  const isDraft = shipment.status === "DRAFT";
  const canReceive = shipment.status === "IN_TRANSIT" || shipment.status === "PARTIALLY_RECEIVED";
  const editable = shipment.status !== "CANCELLED";
  const costLocked = Boolean(shipment.first_received_at) || !(shipment.status === "DRAFT" || shipment.status === "IN_TRANSIT");
  const shown = shipment.status === "CANCELLED" ? lines : activeLines;
  const ticketsToMove = activeLines.filter((line) => line.kind === "ASSIGNMENT" && line.assignment?.ticketLogisticsStatus === "ORDERED").length;
  const lineName = new Map(lines.map((line) => [line.id, line.item.name]));
  const landedTotal = activeLines.reduce((sum, line) => sum + line.landedCostMxnCents, 0);

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="COMPRAS CON SHOPPER · EMBARQUE"
        title={shipment.shipment_number}
        description={`${shipment.carrier}${shipment.tracking_number ? ` · guía ${shipment.tracking_number}` : ""}${shipment.estimated_arrival ? ` · llegada estimada ${formatDate(shipment.estimated_arrival)}` : ""}`}
        action={
          <span className="shopper-header-actions">
            <Button href="/admin/compras/embarques" variant="secondary" size="small">
              Volver
            </Button>
            {editable ? (
              <EditShipmentDialog
                shipmentId={shipment.id}
                carriers={carriers}
                costLocked={costLocked}
                initial={{
                  carrier: shipment.carrier,
                  trackingNumber: shipment.tracking_number ?? "",
                  shippingCost: centsToInput(shipment.shipping_cost_mxn_cents),
                  estimatedArrival: shipment.estimated_arrival ?? "",
                  notes: shipment.notes ?? "",
                }}
              />
            ) : null}
            {editable ? (
              <PaidDialog
                shipmentId={shipment.id}
                shipmentNumber={shipment.shipment_number}
                costCents={shipment.shipping_cost_mxn_cents}
                paid={shipment.paid}
                paidOn={shipment.paid_on}
                today={today}
              />
            ) : null}
            {isDraft ? (
              <>
                <Button href={`/admin/compras/embarques/nuevo?embarque=${shipment.id}`} variant="secondary" size="small">
                  Agregar artículos
                </Button>
                <CancelShipmentDialog shipmentId={shipment.id} />
                {activeLines.length ? <ConfirmDepartureDialog shipmentId={shipment.id} pieces={shipment.expectedPieces} tickets={ticketsToMove} /> : null}
              </>
            ) : null}
            {canReceive && shipment.pendingPieces > 0 ? <ReceiveAllGoodDialog shipmentId={shipment.id} pending={shipment.pendingPieces} /> : null}
          </span>
        }
      />

      <div className="ship-status-row">
        <Badge tone={SHIPMENT_STATUS_TONES[shipment.status]}>{SHIPMENT_STATUS_LABELS[shipment.status]}</Badge>
        {shipment.status !== "CANCELLED" ? (
          <Badge tone={shipment.paid ? "success" : "neutral"}>
            {shipment.paid ? `Envío pagado ${shipment.paid_on ? formatDate(shipment.paid_on) : ""}` : "Envío sin pagar"}
          </Badge>
        ) : null}
        {shipment.incidentLines ? <Badge tone="danger">{shipment.incidentLines} línea(s) con dañadas o faltantes</Badge> : null}
        <small>
          Creado {formatDateTime(shipment.created_at)}
          {shipment.departed_at ? ` · salió ${formatDateTime(shipment.departed_at)}` : ""}
          {shipment.received_at ? ` · recibido completo ${formatDateTime(shipment.received_at)}` : ""}
        </small>
      </div>
      {shipment.status === "CANCELLED" ? (
        <div className="admin-notice">
          <strong>Embarque cancelado el {formatDateTime(shipment.cancelled_at)}.</strong>
          {shipment.cancellation_reason ? `Motivo: ${shipment.cancellation_reason}. ` : ""}Sus artículos volvieron a quedar pendientes de
          envío.
        </div>
      ) : null}
      {shipment.notes ? <p className="admin-hint ship-notes">Notas: {shipment.notes}</p> : null}

      <div className="admin-stats shopper-stats">
        <StatCard label="PIEZAS" value={String(shipment.expectedPieces)} note={`${shipment.lineCount} línea(s) · ${shipment.purchaseCount} compra(s)`} />
        <StatCard
          label="RECIBIDAS BIEN"
          value={String(shipment.goodPieces)}
          note={`${shipment.damagedPieces} dañada(s) · ${shipment.missingPieces} faltante(s)`}
          tone={shipment.damagedPieces || shipment.missingPieces ? "warning" : "default"}
        />
        <StatCard label="PENDIENTES" value={String(shipment.pendingPieces)} note={isDraft ? "Aún no sale" : "Siguen dentro del embarque"} tone={canReceive && shipment.pendingPieces ? "rose" : "default"} />
        <StatCard
          label="COSTO DE ENVÍO"
          value={formatMoney(shipment.shipping_cost_mxn_cents)}
          note={`Mercancía ${formatMoney(shipment.goodsCostMxnCents)} · puesto ${formatMoney(landedTotal)}`}
        />
      </div>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">LÍNEAS DEL EMBARQUE</p>
            <h2>Esperadas vs. recibidas</h2>
          </div>
        </div>
        {shown.length ? (
          <ul className="assign-list">
            {shown.map((line) => {
              const incident = line.damaged + line.missing > 0;
              const label = line.kind === "ASSIGNMENT" ? `el ticket ${line.assignment?.ticketNumber ?? ""}` : `las piezas libres de ${line.item.name}`;
              return (
                <li key={line.id} className={`assign-item${incident ? " ship-line-incident" : ""}`}>
                  <div className="assign-item-head">
                    {line.item.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="shopper-item-thumb" src={line.item.photoUrl} alt="" />
                    ) : (
                      <span className="shopper-item-thumb admin-thumb-fallback" aria-hidden>
                        {initialsOf(line.item.name)}
                      </span>
                    )}
                    <div className="shopper-item-main">
                      <strong>{line.item.name}</strong>
                      <small>
                        {line.item.variant_label ? `${line.item.variant_label} · ` : ""}
                        {line.item.store_name} · {line.item.purchase_number} · {line.item.supplier_name}
                      </small>
                      {line.assignment ? (
                        <small>
                          {line.assignment.clientName} · ticket{" "}
                          <Link className="assign-ticket-link" href={`/admin/pedidos/${line.assignment.orderId}`}>
                            {line.assignment.ticketNumber ?? "—"}
                          </Link>
                        </small>
                      ) : null}
                      <span className="shopper-badges">
                        <LineKindBadge kind={line.kind} />
                        {line.assignment?.ticketLogisticsStatus ? (
                          <Badge tone={line.assignment.ticketLogisticsStatus === "READY_FOR_DELIVERY" ? "success" : "rose"}>
                            {LOGISTICS_STATUS_LABELS[line.assignment.ticketLogisticsStatus] ?? line.assignment.ticketLogisticsStatus}
                          </Badge>
                        ) : null}
                        {incident ? <Badge tone="danger">Incidencia</Badge> : null}
                        {line.status === "CANCELLED" ? <Badge tone="neutral">Cancelada</Badge> : null}
                      </span>
                    </div>
                    <div className="ship-line-actions">
                      {isDraft ? <RemoveLineButton lineId={line.id} label={label} /> : null}
                      {canReceive && line.pending > 0 ? (
                        <ReceiveLineDialog
                          shipmentId={shipment.id}
                          line={{
                            id: line.id,
                            name: line.item.name,
                            variantLabel: line.item.variant_label,
                            kind: line.kind,
                            expected: line.expected,
                            good: line.good,
                            damaged: line.damaged,
                            missing: line.missing,
                            pending: line.pending,
                            clientName: line.assignment?.clientName ?? null,
                            ticketNumber: line.assignment?.ticketNumber ?? null,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                  <dl className="assign-counts ship-counts">
                    <div>
                      <dt>Esperadas</dt>
                      <dd>{line.expected}</dd>
                    </div>
                    <div className="ship-good">
                      <dt>Buenas</dt>
                      <dd>{line.good}</dd>
                    </div>
                    <div className={line.damaged ? "ship-bad" : undefined}>
                      <dt>Dañadas</dt>
                      <dd>{line.damaged}</dd>
                    </div>
                    <div className={line.missing ? "ship-bad" : undefined}>
                      <dt>Faltantes</dt>
                      <dd>{line.missing}</dd>
                    </div>
                    <div className={line.pending && !isDraft && line.status === "ACTIVE" ? "assign-counts-strong" : undefined}>
                      <dt>Pendientes</dt>
                      <dd>{line.pending}</dd>
                    </div>
                  </dl>
                  <p className="ship-costs">
                    Mercancía {formatMoney(line.goodsCostMxnCents)} + envío {formatMoney(line.shippingCostMxnCents)} ={" "}
                    <b>costo puesto {formatMoney(line.landedCostMxnCents)}</b>
                    {line.expected > 1 ? ` (${formatMoney(Math.round(line.landedCostMxnCents / line.expected))} c/u)` : ""}
                  </p>
                  {line.assignment?.incidentReason && incident ? <p className="ship-incident">{line.assignment.incidentReason}</p> : null}
                  {line.kind === "FREE" && line.product_id ? (
                    <p className="ship-costs">
                      {line.good} en buen estado entraron a inventario ·{" "}
                      <Link className="assign-ticket-link" href={`/admin/productos/${line.product_id}`}>
                        ver producto (ponle precio y publícalo)
                      </Link>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="admin-hint">
            Este embarque no tiene artículos.{" "}
            {isDraft ? <Link href={`/admin/compras/embarques/nuevo?embarque=${shipment.id}`}>Agregar artículos</Link> : null}
          </p>
        )}
        <p className="admin-hint" style={{ marginTop: 12 }}>
          El costo de envío se reparte por piezas (centavos exactos). Costo puesto = costo de compra (tienda + tax + comisión) +
          su parte del envío. Solo lo que llega en buen estado avanza: los tickets completos pasan a Listo para entrega y las
          piezas libres a Productos entrega inmediata.
        </p>
      </Card>

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">RECEPCIONES EN LA PAZ</p>
            <h2>Historial</h2>
          </div>
        </div>
        {receipts.length ? (
          <ul className="ship-receipts">
            {[...receipts].reverse().map((receipt) => (
              <li key={receipt.id}>
                <div>
                  <strong>{lineName.get(receipt.line_id) ?? "Línea"}</strong>
                  <small>
                    {formatDateTime(receipt.created_at)}
                    {receipt.receivedBy ? ` · ${receipt.receivedBy}` : ""}
                  </small>
                  <span className="shopper-badges">
                    {receipt.good ? <Badge tone="success">{receipt.good} buena(s)</Badge> : null}
                    {receipt.damaged ? <Badge tone="danger">{receipt.damaged} dañada(s)</Badge> : null}
                    {receipt.missing ? <Badge tone="danger">{receipt.missing} faltante(s)</Badge> : null}
                    {!receipt.good && !receipt.damaged && !receipt.missing ? <Badge tone="neutral">Solo nota/foto</Badge> : null}
                  </span>
                  {receipt.notes ? <p className="ship-receipt-notes">{receipt.notes}</p> : null}
                </div>
                {receipt.photos.length ? (
                  <div className="ship-receipt-photos">
                    {receipt.photos.map((photo) =>
                      photo.url ? (
                        <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer" className="shopper-ticket-photo">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.url} alt="Foto de la recepción" />
                        </a>
                      ) : (
                        <span key={photo.key} className="shopper-ticket-photo shopper-ticket-photo-empty">
                          FOTO
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-hint">
            {isDraft
              ? "Cuando confirmes la salida y llegue la caja, aquí queda cada recepción con sus fotos y observaciones."
              : "Todavía no se recibe nada de este embarque."}
          </p>
        )}
      </Card>
    </main>
  );
}
