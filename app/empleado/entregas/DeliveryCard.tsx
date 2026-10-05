import Link from "next/link";
import { formatMoney, formatTime } from "../../../lib/format";
import type { ScheduledDelivery } from "../../../lib/supabase/staff-deliveries";

const TYPE_LABELS: Record<string, string> = { PICKUP: "Recoge en el lugar", DIDI: "Envío DiDi" };

/** One scheduled delivery: when, where, who, what, and how much is still owed. */
export function DeliveryCard({ delivery, action = "Abrir entrega" }: { delivery: ScheduledDelivery; action?: string }) {
  const units = delivery.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <article className="staff-card staff-delivery-card">
      <div className="staff-delivery-when">
        <strong>{formatTime(delivery.startsAt)}</strong>
        <small>a {formatTime(delivery.endsAt)}</small>
      </div>
      <div className="staff-delivery-body">
        <p className="staff-delivery-client">
          <strong>{delivery.clientName}</strong>
          {delivery.clientPhone ? (
            <a href={`tel:${delivery.clientPhone}`} className="staff-phone">
              {delivery.clientPhone}
            </a>
          ) : null}
        </p>
        <p className="staff-delivery-place">
          {delivery.locationName}
          {delivery.locationAddress ? ` · ${delivery.locationAddress}` : ""}
          {delivery.deliveryTypes.length ? ` · ${delivery.deliveryTypes.map((type) => TYPE_LABELS[type] ?? type).join(" / ")}` : ""}
        </p>
        <ul className="staff-delivery-items">
          {delivery.items.map((item) => (
            <li key={item.ticketId}>
              {item.quantity} × {item.productName}
              {item.variantName && item.variantName !== "Único" ? ` · ${item.variantName}` : ""}
            </li>
          ))}
        </ul>
        <div className="staff-delivery-foot">
          <span className={delivery.balanceCents > 0 ? "staff-balance staff-balance-due" : "staff-balance staff-balance-paid"}>
            {delivery.balanceCents > 0 ? `Saldo pendiente ${formatMoney(delivery.balanceCents)}` : "Pagado"}
          </span>
          <small>{units} pieza(s)</small>
        </div>
      </div>
      <Link className="button button-primary staff-card-action" href={`/empleado/entregas/${delivery.id}`}>
        {action}
      </Link>
    </article>
  );
}
