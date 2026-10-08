import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import { capitalize, formatDayLong, formatTimeOnly } from "../../../lib/account-view";
import { formatMoney } from "../../../lib/format";
import { DELIVERY_REQUESTS_MIGRATION, type PendingRequest } from "../../../lib/supabase/delivery-requests";
import { confirmDeliveryRequestAction } from "./actions";
import { RejectRequestDialog } from "./RejectRequestDialog";

/** "hace 25 min" / "hace 3 h" / "hace 2 días". */
export function waitingText(since: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(since).getTime()) / 60000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} día${days === 1 ? "" : "s"}`;
}

export function RequestCard({ request }: { request: PendingRequest }) {
  const when = `${capitalize(formatDayLong(request.startsAt))}, ${formatTimeOnly(request.startsAt)} a ${formatTimeOnly(request.endsAt)}`;
  return (
    <article className={`agenda-request${request.expired ? " is-expired" : ""}`}>
      <header className="agenda-request-head">
        <div>
          <strong>{request.clientName}</strong>
          {request.clientPhone ? <a href={`tel:${request.clientPhone}`}>{request.clientPhone}</a> : null}
        </div>
        <Badge tone={request.expired ? "danger" : "warning"}>{request.expired ? "El horario ya pasó" : "Por confirmar"}</Badge>
      </header>
      <p className="agenda-request-when">
        <b>{when}</b>
        <span>
          {request.locationName}
          {request.locationAddress ? ` · ${request.locationAddress}` : ""} · {request.deliveryType === "DIDI" ? "Envío por DiDi" : "Recoge en el punto"}
        </span>
        <small>Solicitó {waitingText(request.requestedAt)} · {request.items.length} producto(s) en una ventana de 10 min</small>
      </p>
      <ul className="agenda-request-items">
        {request.items.map((item) => (
          <li key={item.bookingId}>
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="admin-thumb" src={item.imageUrl} alt="" loading="lazy" />
            ) : (
              <span className="admin-thumb admin-thumb-fallback" aria-hidden>LF</span>
            )}
            <span>
              <strong>{item.productName}</strong>
              <small>
                {[item.variantName && item.variantName !== "Único" ? item.variantName : null, item.ticketNumber].filter(Boolean).join(" · ")}
              </small>
            </span>
            <span className={item.balanceCents > 0 ? "agenda-request-balance is-due" : "agenda-request-balance"}>
              {item.balanceCents > 0 ? `Saldo ${formatMoney(item.balanceCents)}` : "Pagado"}
            </span>
          </li>
        ))}
      </ul>
      <footer className="agenda-request-foot">
        <span className={request.balanceCents > 0 ? "agenda-request-balance is-due" : "agenda-request-balance"}>
          {request.balanceCents > 0 ? `Saldo pendiente al entregar: ${formatMoney(request.balanceCents)}` : "Todo pagado"}
        </span>
        <div className="admin-row-actions">
          <RejectRequestDialog visitId={request.visitId} clientName={request.clientName} when={when} />
          {!request.expired && (
            <ConfirmAction
              action={confirmDeliveryRequestAction}
              fields={{ visitId: request.visitId }}
              triggerLabel="Confirmar"
              title={`Confirmar cita · ${request.clientName}`}
              description={`${when} en ${request.locationName}. Los productos pasan a "Entrega programada" y le avisamos a la clienta que ya puede pasar (campanita y Telegram).`}
              confirmLabel="Confirmar cita"
              variant="primary"
            />
          )}
        </div>
      </footer>
    </article>
  );
}

export function DeliveryRequests({ available, requests, error }: { available: boolean; requests: PendingRequest[]; error?: string | null }) {
  if (error) {
    return (
      <Card className="admin-panel agenda-requests">
        <p className="form-message form-error" role="alert">No pudimos cargar las solicitudes por confirmar: {error}</p>
      </Card>
    );
  }
  if (!available) {
    return (
      <div className="admin-notice">
        <strong>Solicitudes por confirmar: pendiente de activar</strong>
        Para que las citas que agendan las clientas esperen tu confirmación (una sola ventana de 10 minutos por visita), aplica{" "}
        <code>{DELIVERY_REQUESTS_MIGRATION}</code> en el editor SQL de Supabase. Mientras tanto, lo que ellas agendan queda confirmado al momento.
      </div>
    );
  }
  return (
    <Card className="admin-panel agenda-requests" id="solicitudes">
      <div className="section-heading">
        <div>
          <p className="micro-label">SOLICITUDES POR CONFIRMAR</p>
          <h2>
            {requests.length ? `${requests.length} visita(s) esperando tu confirmación` : "No hay solicitudes por confirmar"}
          </h2>
        </div>
        {requests.length ? <span className="agenda-request-count" aria-label={`${requests.length} por confirmar`}>{requests.length}</span> : null}
      </div>
      {requests.length ? (
        <div className="agenda-request-list">
          {requests.map((request) => (
            <RequestCard key={request.visitId} request={request} />
          ))}
        </div>
      ) : (
        <p className="admin-hint">Cuando una clienta aparte un horario desde su cuenta aparecerá aquí. El horario queda apartado, pero solo puede pasar cuando lo confirmes.</p>
      )}
    </Card>
  );
}
