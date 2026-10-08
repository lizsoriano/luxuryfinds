import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { LOGISTICS_STATUS_LABELS, formatMoney } from "../../lib/format";
import { PickupNotice } from "./PickupNotice";

export type AccountPurchaseTicket = { id: string; ticket_number: string; product_name_snapshot: string; variant_name_snapshot: string | null; financial_status: string; logistics_status: string; agreed_total_cents: number; paid_principal_cents: number };
export function AccountPurchases({ tickets }: { tickets: AccountPurchaseTicket[] }) {
  const active = tickets.filter(ticket => !["DELIVERED", "CANCELLED_INCIDENT"].includes(ticket.logistics_status));
  return <div className="purchase-list">{active.map((ticket, index) => <Card className="purchase-row" key={ticket.id}>
    <div className={`purchase-thumb tone-${index ? "rose" : "cream"}`}>LF</div>
    <div className="purchase-main"><small>{ticket.ticket_number}</small><h3>{ticket.product_name_snapshot}</h3><p>{ticket.variant_name_snapshot ?? "Producto especial"}</p></div>
    <div className="purchase-state"><Badge tone={ticket.logistics_status === "READY_FOR_DELIVERY" ? "success" : "rose"}>{LOGISTICS_STATUS_LABELS[ticket.logistics_status] ?? ticket.logistics_status}</Badge><strong>{ticket.financial_status === "PAID" ? "Pagado" : `${formatMoney(Math.max(ticket.agreed_total_cents - ticket.paid_principal_cents, 0))} pendiente`}</strong></div>
    {ticket.logistics_status === "READY_FOR_DELIVERY" && <div className="account-pickup"><PickupNotice /></div>}
  </Card>)}</div>;
}
