"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LOGISTICS_STATUS_LABELS } from "../../../lib/format";
import { SALES_LOCATION_STATUSES } from "../../../lib/sales-location";
import { emptyActionState } from "../../../lib/actions";
import { advanceLogisticsStatusAction } from "../pedidos/actions";
import { changeSaleItemLocation } from "./sales-actions";

export function ProductStatusLights({ target, itemId, ticketId, currentStatus, available, cancelled }: { target: string; itemId: string; ticketId: string | null; currentStatus: string | null; available: boolean; cancelled: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(currentStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sale = target.startsWith("s-");
  const closed = cancelled || (!sale && ["DELIVERED", "CANCELLED_INCIDENT", "DELIVERY_SCHEDULED"].includes(currentStatus ?? ""));
  const statuses = sale ? [...SALES_LOCATION_STATUSES, "DELIVERED"] : SALES_LOCATION_STATUSES;
  function choose(status: string) {
    startTransition(async () => {
      const form = new FormData();
      form.set("target", target); form.set("itemId", itemId); form.set("ticketId", ticketId ?? ""); form.set("status", status);
      try {
      const result = await (sale ? changeSaleItemLocation : advanceLogisticsStatusAction)(emptyActionState, form);
      setMessage(result.error ?? result.success);
      if (!result.error) { setSaved(status); router.refresh(); }
      } catch { setMessage("No pudimos guardar el estado. Intenta nuevamente."); }
    });
  }
  return <section className="sales-status-lights" aria-label="Estado del producto">
    <p><strong>Estado del producto</strong> · {cancelled ? "Cancelado" : LOGISTICS_STATUS_LABELS[saved ?? ""] ?? "Pendiente de confirmar"}</p>
    <div className="sales-status-buttons sales-no-print">{statuses.map((status, index) => <button key={status} type="button" aria-pressed={saved === status} disabled={pending || closed || !available || (!sale && !ticketId)} onClick={() => choose(status)}><span className={`sales-status-dot light-${index}`} aria-hidden="true" />{LOGISTICS_STATUS_LABELS[status]}</button>)}</div>
    {!available && <p role="status">Para guardar estados, aplica database/migrations/018_sale_item_fulfillment.sql en Supabase.</p>}
    {!sale && !ticketId && <p className="admin-hint">Confirma el pedido para cambiar su estado.</p>}
    {!cancelled && saved === "READY_FOR_DELIVERY" && <p className="sales-pickup-message">Favor de agendar pickup.{!sale && <> <Link href="/admin/agenda">Agendar pickup</Link></>}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
