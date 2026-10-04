import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction } from "../../../../components/admin/ConfirmAction";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { StatCard } from "../../../../components/ui/StatCard";
import {
  businessToday,
  FINANCIAL_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatMoney,
  initialsOf,
  LOGISTICS_STATUS_LABELS,
} from "../../../../lib/format";
import { listClientOptions, listSupplierOptions } from "../../../../lib/supabase/admin-contacts";
import {
  ASSIGNMENT_STATUS_LABELS,
  assignmentUnavailableMessage,
  getPurchaseAssignments,
  getPurchaseDetail,
  listStoreSuggestions,
  PURCHASE_ITEM_STATUS_LABELS,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUS_TONES,
  PURCHASES_UNAVAILABLE_MESSAGE,
  SHOPPER_PAYMENT_METHOD_LABELS,
  type PurchaseDetail,
} from "../../../../lib/supabase/admin-purchases";
import {
  computeOwed,
  formatRate,
  formatUsd,
  storeKey,
  TICKET_BALANCE_LABELS,
  TICKET_BALANCE_TONES,
  usdCentsToMxnCents,
  type TicketSummary,
} from "../../../../lib/supabase/purchase-math";
import { ConfirmPurchaseDialog, PaymentDialog, VoidPaymentDialog, type ConfirmPreview } from "../AccountForms";
import { AssignDialog, CancelAssignmentDialog, type ClientOption } from "../AssignForms";
import { EditPurchaseDialog } from "../PurchaseHeaderForm";
import { ItemCapture, ItemEditDialog, TicketDialog } from "../TicketForms";
import { cancelPurchaseAction, deleteItemAction, deleteTicketAction } from "../actions";

export const dynamic = "force-dynamic";

const PencilIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 20h9" strokeLinecap="round" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M4 7h16" strokeLinecap="round" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
  </svg>
);

function safeMxn(usdCents: number, rate: number) {
  try {
    return usdCentsToMxnCents(usdCents, rate);
  } catch {
    return null;
  }
}

function DifferenceText({ summary }: { summary: TicketSummary }) {
  if (summary.differenceUsdCents === null) return <span style={{ color: "var(--admin-muted)" }}>—</span>;
  if (summary.differenceUsdCents === 0) return <span style={{ color: "var(--success)" }}>US$0.00</span>;
  return (
    <span className={summary.differenceUsdCents > 0 ? "shopper-diff-short" : "shopper-diff-over"}>
      {summary.differenceUsdCents > 0 ? "+" : "−"}
      {formatUsd(Math.abs(summary.differenceUsdCents))}
    </span>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <main className="admin-content">
      <PageHeader eyebrow="COMPRAS CON SHOPPER" title="Compra" />
      <Card className="admin-panel" style={{ marginTop: 24 }}>
        <p className="form-message form-error" role="alert">
          {message}
        </p>
        <p style={{ marginTop: 12 }}>
          <Button href="/admin/compras" variant="secondary" size="small">
            Volver a compras
          </Button>
        </p>
      </Card>
    </main>
  );
}

function confirmationState(detail: PurchaseDetail) {
  const blockers: string[] = [];
  if (!detail.tickets.length) blockers.push("Agrega al menos un ticket con sus artículos.");
  for (const ticket of detail.tickets) {
    const label = `${ticket.store_name}${ticket.reference ? ` (${ticket.reference})` : ""}`;
    if (!ticket.items.length) blockers.push(`El ticket de ${label} no tiene artículos: captúralos o bórralo.`);
    if (ticket.real_total_usd_cents === null) blockers.push(`Falta el total con tax del ticket de ${label}.`);
  }
  let preview: ConfirmPreview | null = null;
  if (!blockers.length) {
    const totalReal = detail.tickets.reduce((sum, ticket) => sum + (ticket.real_total_usd_cents ?? 0), 0);
    try {
      const owed = computeOwed(totalReal, detail.purchase.commission_percent, detail.purchase.exchange_rate);
      preview = {
        totalRealUsdCents: totalReal,
        commissionPercent: detail.purchase.commission_percent,
        commissionUsdCents: owed.commissionUsdCents,
        owedUsdCents: owed.owedUsdCents,
        exchangeRateLabel: formatRate(detail.purchase.exchange_rate),
        owedMxnCents: owed.owedMxnCents,
      };
    } catch {
      blockers.push("Revisa el tipo de cambio y la comisión de la compra.");
    }
  }
  return {
    blockers,
    preview,
    differences: detail.tickets
      .filter((ticket) => ticket.summary.differenceUsdCents !== null && ticket.summary.differenceUsdCents !== 0)
      .map((ticket) => ({
        storeName: `${ticket.store_name}${ticket.reference ? ` (${ticket.reference})` : ""}`,
        differenceUsdCents: ticket.summary.differenceUsdCents ?? 0,
      })),
    missingPhotos: detail.tickets
      .filter((ticket) => !ticket.hasPhoto)
      .map((ticket) => `${ticket.store_name}${ticket.reference ? ` (${ticket.reference})` : ""}`),
  };
}

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let detail: PurchaseDetail | null;
  try {
    detail = await getPurchaseDetail(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    return <ErrorPage message={message === PURCHASES_UNAVAILABLE_MESSAGE ? message : `No pudimos cargar la compra: ${message}`} />;
  }
  if (!detail) notFound();

  const { purchase, supplier, tickets, stores, summary, estimate, payments } = detail;
  const isOpen = purchase.status === "OPEN";
  const isConfirmed = purchase.status === "CONFIRMED";
  const today = businessToday();
  const [shoppers, storeSuggestions] = isOpen ? await Promise.all([listSupplierOptions(), listStoreSuggestions()]) : [[], []];
  const shopperName = supplier?.name ?? "Shopper eliminado";
  const rateLabel = formatRate(purchase.exchange_rate);
  const capturedMxn = safeMxn(summary.capturedWithTaxUsdCents, purchase.exchange_rate);
  const confirmation = isOpen ? confirmationState(detail) : null;
  const allItems = tickets.flatMap((ticket) => ticket.items.map((item) => ({ ...item, storeName: ticket.store_name })));

  // Phase 2 (migration 011): who each confirmed line went to. Degrades to a notice.
  let assignmentData: Awaited<ReturnType<typeof getPurchaseAssignments>> | null = null;
  let assignmentError: string | null = null;
  let clients: ClientOption[] = [];
  if (isConfirmed) {
    try {
      [assignmentData, clients] = await Promise.all([getPurchaseAssignments(purchase.id), listClientOptions().catch(() => [])]);
    } catch (error) {
      assignmentError = error instanceof Error ? error.message : "error desconocido";
    }
  }
  const assignmentNotice = assignmentData ? assignmentUnavailableMessage(assignmentData.state) : null;
  const canAssign = assignmentData?.state === "ready";
  const activeAssignments = (assignmentData?.assignments ?? []).filter((row) => row.status === "ACTIVE");
  const soldCents = activeAssignments.reduce((sum, row) => sum + row.totalCents, 0);
  const soldCostCents = activeAssignments.reduce((sum, row) => sum + row.cost_mxn_cents, 0);

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="COMPRAS CON SHOPPER"
        title={`Compra ${purchase.purchase_number}`}
        description={`${shopperName} · ${formatDate(purchase.purchase_date)} · TC ${rateLabel} · Comisión ${purchase.commission_percent} %`}
        action={
          <span className="shopper-header-actions">
            <Button href="/admin/compras" variant="secondary" size="small">
              Volver
            </Button>
            {isOpen ? (
              <>
                <EditPurchaseDialog
                  shoppers={shoppers}
                  today={today}
                  initial={{
                    purchaseId: purchase.id,
                    supplierId: purchase.supplier_id,
                    purchaseDate: purchase.purchase_date,
                    exchangeRate: rateLabel,
                    commission: String(purchase.commission_percent),
                    notes: purchase.notes ?? "",
                  }}
                />
                <ConfirmAction
                  action={cancelPurchaseAction}
                  fields={{ id: purchase.id }}
                  triggerLabel="Cancelar compra"
                  title="Cancelar compra"
                  description="La compra queda cancelada como historial (no se borra) y ya no se podrá capturar ni confirmar. Úsalo si el viaje o el encargo no se hizo."
                  confirmLabel="Cancelar compra"
                  variant="danger"
                />
              </>
            ) : null}
          </span>
        }
      />

      <div className="shopper-status-row">
        <Badge tone={PURCHASE_STATUS_TONES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
        {purchase.notes ? <span className="admin-hint">{purchase.notes}</span> : null}
      </div>

      {isConfirmed ? (
        <section className="admin-stats shopper-stats">
          <StatCard label="TICKETS CON TAX" value={formatUsd(purchase.total_real_usd_cents ?? 0)} note={`${summary.ticketCount} ticket(s) · ${summary.pieces} pza(s)`} />
          <StatCard label={`COMISIÓN ${purchase.commission_percent} %`} value={formatUsd(purchase.commission_usd_cents ?? 0)} note="Sobre el total con tax" />
          <StatCard label="LE DEBES AL SHOPPER" value={formatMoney(purchase.owed_mxn_cents ?? 0)} note={`${formatUsd(purchase.owed_usd_cents ?? 0)} a TC ${rateLabel}`} tone="rose" />
          <StatCard
            label="SALDO PENDIENTE"
            value={formatMoney(detail.balanceMxnCents ?? 0)}
            note={`Abonado ${formatMoney(detail.paidMxnCents)}`}
            tone={(detail.balanceMxnCents ?? 0) > 0 ? "warning" : "default"}
          />
        </section>
      ) : (
        <section className="admin-stats shopper-stats">
          <StatCard label="CAPTURADO SIN TAX" value={formatUsd(summary.subtotalUsdCents)} note={`${summary.ticketCount} ticket(s) · ${summary.pieces} pza(s)`} />
          <StatCard label="TAX DE LOS TICKETS" value={formatUsd(summary.taxUsdCents)} note="Se suma una vez por ticket" />
          <StatCard
            label="CAPTURADO CON TAX"
            value={formatUsd(summary.capturedWithTaxUsdCents)}
            note={capturedMxn !== null ? `≈ ${formatMoney(capturedMxn)} a TC ${rateLabel}` : "—"}
          />
          <StatCard
            label={isOpen ? "A PAGAR (ESTIMADO)" : "COMPRA CANCELADA"}
            value={isOpen && estimate ? formatMoney(estimate.owedMxnCents) : "—"}
            note={isOpen && estimate ? `${formatUsd(estimate.owedUsdCents)} con comisión ${purchase.commission_percent} %` : "Sin saldo con el shopper"}
            tone="rose"
          />
        </section>
      )}

      {purchase.status === "CANCELLED" ? (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <p className="micro-label">CANCELADA</p>
          <p className="admin-hint" style={{ marginTop: 10 }}>
            Esta compra se canceló el {formatDateTime(purchase.cancelled_at)}
            {purchase.cancellation_reason ? ` (${purchase.cancellation_reason})` : ""} y queda solo como historial.
          </p>
        </Card>
      ) : null}

      {isConfirmed ? (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <div className="section-heading">
            <div>
              <p className="micro-label">CUENTA CON EL SHOPPER</p>
              <h2>{shopperName}</h2>
            </div>
            {(detail.balanceMxnCents ?? 0) > 0 && supplier ? (
              <PaymentDialog
                supplierId={supplier.id}
                supplierName={shopperName}
                purchaseId={purchase.id}
                pendingMxnCents={detail.balanceMxnCents}
                today={today}
                triggerLabel="Registrar abono"
              />
            ) : null}
          </div>
          <dl className="shopper-totals shopper-totals-wide">
            <div>
              <dt>Total de los tickets con tax</dt>
              <dd>{formatUsd(purchase.total_real_usd_cents ?? 0)}</dd>
            </div>
            <div>
              <dt>Comisión {purchase.commission_percent} %</dt>
              <dd>{formatUsd(purchase.commission_usd_cents ?? 0)}</dd>
            </div>
            <div>
              <dt>Le debes en dólares</dt>
              <dd>{formatUsd(purchase.owed_usd_cents ?? 0)}</dd>
            </div>
            <div className="shopper-totals-strong">
              <dt>Le debes en pesos (TC {rateLabel})</dt>
              <dd>{formatMoney(purchase.owed_mxn_cents ?? 0)}</dd>
            </div>
            <div>
              <dt>Abonado</dt>
              <dd>− {formatMoney(detail.paidMxnCents)}</dd>
            </div>
            <div className="shopper-totals-strong">
              <dt>Saldo pendiente</dt>
              <dd>{(detail.balanceMxnCents ?? 0) === 0 ? "Liquidado" : formatMoney(detail.balanceMxnCents ?? 0)}</dd>
            </div>
          </dl>
          {purchase.difference_acknowledged ? (
            <p className="admin-hint shopper-warning" style={{ marginTop: 12 }}>
              Se confirmó con diferencia entre lo capturado y los tickets: {formatUsd(purchase.difference_usd_cents ?? 0)} neto
              (positivo = los tickets dicen más de lo capturado). Se pagó lo que dicen los tickets.
            </p>
          ) : null}
          <p className="admin-hint" style={{ marginTop: 8 }}>
            Confirmada el {formatDateTime(purchase.confirmed_at)}. Los montos quedaron congelados con el tipo de cambio de esta compra.
          </p>

          <h3 className="shopper-subheading">Abonos de esta compra</h3>
          {payments.length ? (
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Método</th>
                    <th>Nota</th>
                    <th className="numeric">Monto</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className={payment.voided_at ? "shopper-voided" : undefined}>
                      <td>{formatDate(payment.paid_on)}</td>
                      <td>{SHOPPER_PAYMENT_METHOD_LABELS[payment.method]}</td>
                      <td style={{ color: "var(--admin-muted)" }}>
                        {payment.note ?? "—"}
                        {payment.voided_at ? <span className="admin-cell-sub">Anulado: {payment.void_reason}</span> : null}
                      </td>
                      <td className="numeric">{formatMoney(payment.amount_mxn_cents)}</td>
                      <td>
                        {payment.voided_at ? (
                          <Badge tone="neutral">Anulado</Badge>
                        ) : (
                          <VoidPaymentDialog paymentId={payment.id} amountMxnCents={payment.amount_mxn_cents} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-hint">Todavía no registras abonos para esta compra.</p>
          )}
        </Card>
      ) : null}

      {isConfirmed ? (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <div className="section-heading">
            <div>
              <p className="micro-label">INVENTARIO POR LLEGAR</p>
              <h2>Comprados, pendientes de envío</h2>
            </div>
            <Button href={`/admin/compras/pendientes?purchase=${purchase.id}`} variant="secondary" size="small">
              Ver en pendientes
            </Button>
          </div>
          {assignmentError ? (
            <p className="form-message form-error" role="alert">
              No pudimos cargar las asignaciones: {assignmentError}
            </p>
          ) : assignmentNotice ? (
            <div className="admin-notice">
              <strong>{assignmentNotice}</strong>
              Para asignar estas piezas a tus clientas (y generar su ticket de venta) corre ese archivo en el editor SQL de
              Supabase. Mientras tanto la compra, sus costos y los abonos funcionan igual.
            </div>
          ) : null}
          <ul className="assign-list">
            {allItems.map((item) => {
              const counts = assignmentData?.availability.get(item.id) ?? {
                purchased: item.quantity,
                assigned: 0,
                available: item.quantity,
                assignedCostMxnCents: 0,
              };
              const rows = (assignmentData?.assignments ?? []).filter((row) => row.purchase_item_id === item.id);
              return (
                <li key={item.id} id={`articulo-${item.id}`} className="assign-item">
                  <div className="assign-item-head">
                    {item.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="shopper-item-thumb" src={item.photoUrl} alt="" />
                    ) : (
                      <span className="shopper-item-thumb admin-thumb-fallback" aria-hidden>
                        {initialsOf(item.name)}
                      </span>
                    )}
                    <div className="shopper-item-main">
                      <strong>{item.name}</strong>
                      <small>
                        {item.variant_label ? `${item.variant_label} · ` : ""}
                        {item.storeName} · {formatUsd(item.unit_price_usd_cents)} c/u en tienda
                      </small>
                      <span className="shopper-badges">
                        <Badge tone={item.status === "PURCHASED" ? "rose" : "neutral"}>{PURCHASE_ITEM_STATUS_LABELS[item.status]}</Badge>
                      </span>
                    </div>
                    {canAssign && counts.available > 0 && item.status === "PURCHASED" && item.line_cost_mxn_cents !== null ? (
                      <AssignDialog
                        clients={clients}
                        item={{
                          id: item.id,
                          purchaseId: purchase.id,
                          name: item.name,
                          variantLabel: item.variant_label,
                          storeName: item.storeName,
                          purchased: counts.purchased,
                          assigned: counts.assigned,
                          available: counts.available,
                          assignedCostMxnCents: counts.assignedCostMxnCents,
                          lineCostMxnCents: item.line_cost_mxn_cents,
                        }}
                      />
                    ) : null}
                  </div>
                  <dl className="assign-counts">
                    <div>
                      <dt>Comprado</dt>
                      <dd>{counts.purchased}</dd>
                    </div>
                    <div>
                      <dt>Asignado</dt>
                      <dd>{canAssign ? counts.assigned : "—"}</dd>
                    </div>
                    <div className={canAssign && counts.available > 0 ? "assign-counts-strong" : undefined}>
                      <dt>Disponible</dt>
                      <dd>{canAssign ? counts.available : "—"}</dd>
                    </div>
                    <div>
                      <dt>Costo c/u</dt>
                      <dd>{item.unit_cost_mxn_cents !== null ? formatMoney(item.unit_cost_mxn_cents) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Costo línea</dt>
                      <dd>{item.line_cost_mxn_cents !== null ? formatMoney(item.line_cost_mxn_cents) : "—"}</dd>
                    </div>
                  </dl>
                  {rows.length ? (
                    <ul className="assign-rows">
                      {rows.map((row) => {
                        const cancelled = row.status === "CANCELLED";
                        return (
                          <li key={row.id} className={cancelled ? "assign-row assign-row-cancelled" : "assign-row"}>
                            <div className="assign-row-main">
                              <strong>{row.clientName}</strong>
                              <small>
                                {row.quantity} × {formatMoney(row.unit_price_cents)} = <b>{formatMoney(row.totalCents)}</b>
                                {" · "}costo {formatMoney(row.cost_mxn_cents)}
                                {" · "}utilidad {formatMoney(row.totalCents - row.cost_mxn_cents)}
                              </small>
                              <small>
                                Ticket{" "}
                                <Link className="assign-ticket-link" href={`/admin/pedidos/${row.order_id}`}>
                                  {row.ticketNumber ?? "—"}
                                </Link>
                                {" · "}
                                {formatDateTime(row.created_at)}
                              </small>
                              {cancelled ? (
                                <small>
                                  Cancelada el {formatDateTime(row.cancelled_at)}
                                  {row.cancellation_reason ? `: ${row.cancellation_reason}` : ""}
                                </small>
                              ) : null}
                              <span className="shopper-badges">
                                <Badge tone={cancelled ? "neutral" : "success"}>{ASSIGNMENT_STATUS_LABELS[row.status]}</Badge>
                                {!cancelled && row.ticketLogisticsStatus ? (
                                  <Badge tone="rose">{LOGISTICS_STATUS_LABELS[row.ticketLogisticsStatus] ?? row.ticketLogisticsStatus}</Badge>
                                ) : null}
                                {!cancelled && row.ticketFinancialStatus ? (
                                  <Badge tone={row.ticketFinancialStatus === "PAID" ? "success" : "warning"}>
                                    {FINANCIAL_STATUS_LABELS[row.ticketFinancialStatus] ?? row.ticketFinancialStatus}
                                  </Badge>
                                ) : null}
                              </span>
                            </div>
                            {!cancelled && row.ticketLogisticsStatus === "ORDERED" ? (
                              <CancelAssignmentDialog
                                assignmentId={row.id}
                                purchaseId={purchase.id}
                                summary={`${row.clientName}: ${row.quantity} pza × ${formatMoney(row.unit_price_cents)} (ticket ${row.ticketNumber ?? "—"})`}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <dl className="shopper-totals shopper-totals-wide" style={{ marginTop: 12 }}>
            <div className="shopper-totals-strong">
              <dt>Costo total (= lo que le debes al shopper)</dt>
              <dd>{formatMoney(allItems.reduce((sum, item) => sum + (item.line_cost_mxn_cents ?? 0), 0))}</dd>
            </div>
            {canAssign ? (
              <>
                <div>
                  <dt>Vendido a clientas (asignaciones activas)</dt>
                  <dd>{formatMoney(soldCents)}</dd>
                </div>
                <div>
                  <dt>Costo de lo vendido</dt>
                  <dd>{formatMoney(soldCostCents)}</dd>
                </div>
                <div>
                  <dt>Utilidad de lo vendido (sin paquetería)</dt>
                  <dd>{formatMoney(soldCents - soldCostCents)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Costo puesto en tienda: precio + su parte del tax del ticket + comisión, en pesos al TC de la compra. No incluye
            paquetería (se repartirá al crear el embarque). Con varias piezas, el costo por pieza va redondeado al centavo; el
            costo total de la línea es el exacto. Al asignar, cada clienta recibe su ticket de venta con el precio que tú pongas;
            lo que no asignes queda disponible.
          </p>
        </Card>
      ) : null}

      <section className="shopper-section">
        <div className="section-heading">
          <div>
            <p className="micro-label">{isOpen ? "CAPTURA" : "DETALLE"}</p>
            <h2>Tickets de tienda ({tickets.length})</h2>
          </div>
          {isOpen ? (
            <TicketDialog purchaseId={purchase.id} storeSuggestions={storeSuggestions} triggerLabel="＋ Agregar ticket" triggerVariant="primary" />
          ) : null}
        </div>

        {!tickets.length ? (
          <Card className="admin-panel">
            <EmptyState
              title="Sin tickets todavía"
              description={
                isOpen
                  ? "Agrega un ticket por cada compra en caja (tienda + tax). Dentro de cada ticket capturas los artículos con foto, cantidad y precio."
                  : "Esta compra no tuvo tickets."
              }
            />
          </Card>
        ) : null}

        {tickets.map((ticket, index) => {
          const store = stores.find((entry) => entry.key === storeKey(ticket.store_name));
          const label = `${ticket.store_name}${ticket.reference ? ` (${ticket.reference})` : ""}`;
          return (
            <Card key={ticket.id} className="admin-panel shopper-ticket">
              <div className="shopper-ticket-head">
                <div className="shopper-ticket-title">
                  {ticket.photoUrl ? (
                    <a href={ticket.photoUrl} target="_blank" rel="noreferrer" className="shopper-ticket-photo" title="Ver foto del ticket">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ticket.photoUrl} alt={`Foto del ticket de ${ticket.store_name}`} />
                    </a>
                  ) : (
                    <span className="shopper-ticket-photo shopper-ticket-photo-empty" aria-hidden>
                      TICKET
                    </span>
                  )}
                  <div>
                    <h3>{ticket.store_name}</h3>
                    <p className="admin-hint">
                      {ticket.reference ? `${ticket.reference} · ` : ""}
                      {ticket.summary.pieces} pza(s)
                    </p>
                    <span className="shopper-badges">
                      <Badge tone={TICKET_BALANCE_TONES[ticket.summary.balance]}>{TICKET_BALANCE_LABELS[ticket.summary.balance]}</Badge>
                      {!ticket.hasPhoto ? <Badge tone="warning">{isOpen ? "Foto del ticket pendiente" : "Sin foto del ticket"}</Badge> : null}
                    </span>
                  </div>
                </div>
                {isOpen ? (
                  <div className="admin-row-actions">
                    <TicketDialog
                      purchaseId={purchase.id}
                      storeSuggestions={storeSuggestions}
                      triggerLabel={ticket.real_total_usd_cents === null ? "Cuadrar ticket" : "Editar ticket"}
                      ticket={{
                        id: ticket.id,
                        store_name: ticket.store_name,
                        reference: ticket.reference,
                        tax_usd_cents: ticket.tax_usd_cents,
                        real_total_usd_cents: ticket.real_total_usd_cents,
                        hasPhoto: ticket.hasPhoto,
                        photoUrl: ticket.photoUrl,
                      }}
                    />
                    <ConfirmAction
                      action={deleteTicketAction}
                      fields={{ purchaseId: purchase.id, ticketId: ticket.id }}
                      triggerLabel={`Borrar ticket de ${label}`}
                      triggerIcon={<TrashIcon />}
                      title="Borrar ticket"
                      description={
                        ticket.items.length
                          ? `Se borra el ticket de ${label} junto con sus ${ticket.items.length} artículo(s) y sus fotos.`
                          : `Se borra el ticket de ${label}.`
                      }
                      confirmLabel="Borrar ticket"
                      variant="danger"
                    />
                  </div>
                ) : null}
              </div>

              {ticket.items.length ? (
                <ul className="shopper-item-list">
                  {ticket.items.map((item) => (
                    <li key={item.id} className="shopper-item">
                      {item.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="shopper-item-thumb" src={item.photoUrl} alt="" />
                      ) : (
                        <span className="shopper-item-thumb admin-thumb-fallback" aria-hidden>
                          {initialsOf(item.name)}
                        </span>
                      )}
                      <div className="shopper-item-main">
                        <strong>{item.name}</strong>
                        <small>
                          {item.variant_label ? `${item.variant_label} · ` : ""}
                          {item.quantity} × {formatUsd(item.unit_price_usd_cents)}
                        </small>
                      </div>
                      <strong className="shopper-item-amount">{formatUsd(item.subtotalUsdCents)}</strong>
                      {isOpen ? (
                        <div className="shopper-item-actions">
                          <ItemEditDialog purchaseId={purchase.id} ticketId={ticket.id} item={item} icon={<PencilIcon />} />
                          <ConfirmAction
                            action={deleteItemAction}
                            fields={{ purchaseId: purchase.id, itemId: item.id }}
                            triggerLabel={`Borrar ${item.name}`}
                            triggerIcon={<TrashIcon />}
                            title="Borrar artículo"
                            description={`Se borra "${item.name}" (${item.quantity} × ${formatUsd(item.unit_price_usd_cents)}) de este ticket.`}
                            confirmLabel="Borrar"
                            variant="danger"
                          />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-hint shopper-empty-ticket">Sin artículos todavía.</p>
              )}

              <dl className="shopper-ticket-totals">
                <div>
                  <dt>Subtotal capturado</dt>
                  <dd>{formatUsd(ticket.summary.subtotalUsdCents)}</dd>
                </div>
                <div>
                  <dt>Tax del ticket</dt>
                  <dd>{formatUsd(ticket.summary.taxUsdCents)}</dd>
                </div>
                <div>
                  <dt>Capturado con tax</dt>
                  <dd>{formatUsd(ticket.summary.capturedWithTaxUsdCents)}</dd>
                </div>
                <div>
                  <dt>Total del ticket</dt>
                  <dd>{ticket.real_total_usd_cents !== null ? formatUsd(ticket.real_total_usd_cents) : "Pendiente"}</dd>
                </div>
                <div>
                  <dt>Diferencia</dt>
                  <dd>
                    <DifferenceText summary={ticket.summary} />
                  </dd>
                </div>
              </dl>

              {isOpen ? (
                <ItemCapture
                  key={`${ticket.id}-capture`}
                  purchaseId={purchase.id}
                  ticketId={ticket.id}
                  defaultOpen={index === tickets.length - 1}
                  totals={{
                    ticketSubtotalUsdCents: ticket.summary.subtotalUsdCents,
                    ticketPieces: ticket.summary.pieces,
                    storeName: store?.storeName ?? ticket.store_name,
                    storeSubtotalUsdCents: store?.subtotalUsdCents ?? ticket.summary.subtotalUsdCents,
                    storeTicketCount: store?.ticketCount ?? 1,
                    purchaseSubtotalUsdCents: summary.subtotalUsdCents,
                    purchaseCapturedWithTaxUsdCents: summary.capturedWithTaxUsdCents,
                    purchasePieces: summary.pieces,
                    purchaseCapturedMxnCents: capturedMxn,
                  }}
                />
              ) : null}
            </Card>
          );
        })}
      </section>

      {stores.length ? (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <div className="section-heading">
            <div>
              <p className="micro-label">ACUMULADO</p>
              <h2>Por tienda</h2>
            </div>
          </div>
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Tienda</th>
                  <th className="numeric">Tickets</th>
                  <th className="numeric">Piezas</th>
                  <th className="numeric">Sin tax</th>
                  <th className="numeric">Tax</th>
                  <th className="numeric">Con tax</th>
                  <th className="numeric">≈ MXN</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const mxn = safeMxn(store.capturedWithTaxUsdCents, purchase.exchange_rate);
                  return (
                    <tr key={store.key}>
                      <td>
                        <strong>{store.storeName}</strong>
                      </td>
                      <td className="numeric">{store.ticketCount}</td>
                      <td className="numeric">{store.pieces}</td>
                      <td className="numeric">{formatUsd(store.subtotalUsdCents)}</td>
                      <td className="numeric">{formatUsd(store.taxUsdCents)}</td>
                      <td className="numeric">{formatUsd(store.capturedWithTaxUsdCents)}</td>
                      <td className="numeric">{mxn !== null ? formatMoney(mxn) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Toda la compra</td>
                  <td className="numeric">{summary.ticketCount}</td>
                  <td className="numeric">{summary.pieces}</td>
                  <td className="numeric">{formatUsd(summary.subtotalUsdCents)}</td>
                  <td className="numeric">{formatUsd(summary.taxUsdCents)}</td>
                  <td className="numeric" style={{ fontWeight: 600 }}>
                    {formatUsd(summary.capturedWithTaxUsdCents)}
                  </td>
                  <td className="numeric">{capturedMxn !== null ? formatMoney(capturedMxn) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="admin-hint" style={{ marginTop: 10 }}>
            Las tiendas se agrupan por nombre (sin importar mayúsculas, acentos ni espacios). En pesos es solo referencia al TC
            de la compra, sin comisión.
          </p>
        </Card>
      ) : null}

      {isOpen && confirmation && tickets.length ? (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <div className="section-heading">
            <div>
              <p className="micro-label">CUADRE</p>
              <h2>Tickets contra lo capturado</h2>
            </div>
            <ConfirmPurchaseDialog
              purchaseId={purchase.id}
              preview={confirmation.preview}
              blockers={confirmation.blockers}
              differences={confirmation.differences}
              missingPhotos={confirmation.missingPhotos}
            />
          </div>
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th className="numeric">Capturado con tax</th>
                  <th className="numeric">Total del ticket</th>
                  <th className="numeric">Diferencia</th>
                  <th>Cuadre</th>
                  <th>Foto</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <strong>{ticket.store_name}</strong>
                      {ticket.reference ? <span className="admin-cell-sub">{ticket.reference}</span> : null}
                    </td>
                    <td className="numeric">{formatUsd(ticket.summary.capturedWithTaxUsdCents)}</td>
                    <td className="numeric">{ticket.real_total_usd_cents !== null ? formatUsd(ticket.real_total_usd_cents) : "Pendiente"}</td>
                    <td className="numeric">
                      <DifferenceText summary={ticket.summary} />
                    </td>
                    <td>
                      <Badge tone={TICKET_BALANCE_TONES[ticket.summary.balance]}>{TICKET_BALANCE_LABELS[ticket.summary.balance]}</Badge>
                    </td>
                    <td>{ticket.hasPhoto ? <Badge tone="success">Con foto</Badge> : <Badge tone="warning">Pendiente</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="admin-hint" style={{ marginTop: 10 }}>
            Diferencia = total del ticket − (artículos + tax). <strong>Falta capturar</strong>: el ticket dice más que lo capturado;
            <strong> Sobra</strong>: capturaste de más. Puedes confirmar con diferencia si la reconoces; se paga lo que dicen los
            tickets.
          </p>
        </Card>
      ) : null}

      <p className="admin-hint" style={{ marginTop: 16 }}>
        Abierta el {formatDateTime(purchase.created_at)}
        {purchase.confirmed_at ? ` · Confirmada el ${formatDateTime(purchase.confirmed_at)}` : ""}
      </p>
    </main>
  );
}
