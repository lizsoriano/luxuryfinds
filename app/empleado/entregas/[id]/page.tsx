import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime, formatMoney, formatTime } from "../../../../lib/format";
import { getDeliveryDetail } from "../../../../lib/supabase/staff-deliveries";
import { STAFF_DELIVERIES_MIGRATION_FILE } from "../../../../lib/supabase/staff-schema";
import { DeliveryFlow } from "../DeliveryFlow";

export const dynamic = "force-dynamic";

const TRANSFER_STATUS: Record<string, string> = {
  REPORTED: "Transferencia reportada · pendiente de validar",
  CONFIRMED: "Transferencia confirmada",
  REJECTED: "Transferencia rechazada por la dueña",
};

export default async function StaffDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let detail;
  try {
    detail = await getDeliveryDetail(id);
  } catch (error) {
    return (
      <main className="staff-content">
        <p className="form-message form-error" role="alert">
          No pudimos cargar la entrega: {error instanceof Error ? error.message : "error desconocido"}
        </p>
      </main>
    );
  }
  if (!detail) notFound();

  const back = (
    <Link className="staff-back" href="/empleado/entregas">
      ← Entregas programadas
    </Link>
  );

  if (detail.receipt) {
    const receipt = detail.receipt;
    return (
      <main className="staff-content staff-narrow">
        {back}
        <div className="staff-card staff-receipt">
          <span className="staff-receipt-mark" aria-hidden>
            ✓
          </span>
          <h1 className="staff-title">Entrega confirmada</h1>
          <p className="staff-lead">
            {formatDateTime(receipt.deliveredAt)} · por {receipt.deliveredBy}
          </p>
          <dl className="staff-summary">
            <div>
              <dt>Tickets</dt>
              <dd>{receipt.ticketNumbers.join(", ")}</dd>
            </div>
            <div>
              <dt>Recibió</dt>
              <dd>{receipt.receivedBy === "CLIENT" ? "La clienta" : `${receipt.receiverName} (${receipt.receiverRelationship})`}</dd>
            </div>
            <div>
              <dt>Cobro</dt>
              <dd>
                {receipt.amountCollectedCents > 0
                  ? `${formatMoney(receipt.amountCollectedCents)} · ${receipt.paymentMethod === "CASH" ? "efectivo" : "transferencia"}`
                  : "Sin cobro"}
                {receipt.paymentReference ? ` · Ref. ${receipt.paymentReference}` : ""}
              </dd>
            </div>
            {receipt.transferStatus ? (
              <div>
                <dt>Estado</dt>
                <dd>{TRANSFER_STATUS[receipt.transferStatus]}</dd>
              </div>
            ) : null}
            <div>
              <dt>Saldo que quedó</dt>
              <dd className={receipt.balanceAfterCents > 0 ? "staff-warning" : ""}>{formatMoney(receipt.balanceAfterCents)}</dd>
            </div>
            {receipt.notes ? (
              <div>
                <dt>Observaciones</dt>
                <dd>{receipt.notes}</dd>
              </div>
            ) : null}
          </dl>
          <Link className="button button-primary button-full" href="/empleado/confirmar">
            Ir a mi caja y siguientes entregas
          </Link>
        </div>
      </main>
    );
  }

  const delivery = detail.delivery;
  if (!delivery) {
    return (
      <main className="staff-content staff-narrow">
        {back}
        <div className="staff-empty">
          <strong>Esta cita ya no está activa</strong>
          <p>Se canceló o se completó desde la Agenda de la dueña.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="staff-content staff-narrow">
      {back}
      <div className="staff-delivery-head">
        <p className="staff-eyebrow">
          {formatDate(delivery.day)} · {formatTime(delivery.startsAt)} a {formatTime(delivery.endsAt)}
        </p>
        <h1 className="staff-title">{delivery.clientName}</h1>
        <p className="staff-lead">
          {delivery.clientPhone ? (
            <a className="staff-phone" href={`tel:${delivery.clientPhone}`}>
              {delivery.clientPhone}
            </a>
          ) : null}
          {delivery.clientPhone ? " · " : ""}
          {delivery.locationName}
          {delivery.locationAddress ? ` · ${delivery.locationAddress}` : ""}
        </p>
      </div>
      {delivery.pendingConfirmation ? (
        <>
          <ul className="staff-card staff-panel staff-delivery-items">
            {delivery.items.map((item) => (
              <li key={item.ticketId}>
                {item.quantity} × {item.productName} · saldo {formatMoney(item.balanceCents)}
              </li>
            ))}
          </ul>
          <div className="staff-note">
            <strong>Por confirmar por la dueña.</strong> La clienta apartó este horario, pero todavía no es una cita confirmada: no se
            entrega hasta que la dueña la confirme en su Agenda.
          </div>
        </>
      ) : detail.confirmAvailable ? (
        <DeliveryFlow delivery={delivery} bookingId={id} />
      ) : (
        <>
          <ul className="staff-card staff-panel staff-delivery-items">
            {delivery.items.map((item) => (
              <li key={item.ticketId}>
                {item.quantity} × {item.productName} · saldo {formatMoney(item.balanceCents)}
              </li>
            ))}
          </ul>
          <div className="staff-note">
            <strong>Confirmar entregas todavía no está activo.</strong> Falta aplicar <code>{STAFF_DELIVERIES_MIGRATION_FILE}</code> en
            el editor SQL de Supabase. Mientras tanto la dueña marca la entrega desde su Agenda.
          </div>
        </>
      )}
    </main>
  );
}
