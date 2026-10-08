"use client";
import { useState, useTransition } from "react";
import { Dialog } from "../../../components/ui/Dialog";
import { Button } from "../../../components/ui/Button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LOGISTICS_STATUS_LABELS } from "../../../lib/format";
import { SALES_LOCATION_STATUSES } from "../../../lib/sales-location";
import { emptyActionState } from "../../../lib/actions";
import { advanceLogisticsStatusAction } from "../pedidos/actions";
import { changeSaleItemLocation } from "./sales-actions";

export function ProductStatusLights({ target, itemId, ticketId, currentStatus, available, cancelled }: { target: string; itemId: string; ticketId: string | null; currentStatus: string | null; available: boolean; cancelled: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saved, setSaved] = useState(currentStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sale = target.startsWith("s-");
  const closed = cancelled || (!sale && ["DELIVERED", "CANCELLED_INCIDENT", "DELIVERY_SCHEDULED"].includes(currentStatus ?? ""));
  const statuses = sale ? [...SALES_LOCATION_STATUSES, "DELIVERED"] : SALES_LOCATION_STATUSES;
  const confirmation: Record<string, string> = {
    ORDERED: "¿Deseas confirmar que el producto ya está en bodega de McAllen?",
    IN_TRANSIT: "¿Deseas confirmar que el producto ya está en paquetería?",
    RECEIVED_LA_PAZ: "¿Deseas confirmar que el producto ya está en la sucursal de La Paz?",
    READY_FOR_DELIVERY: "¿Deseas confirmar que el producto ya está listo para entrega en La Paz?",
    DELIVERED: "¿Deseas confirmar que el producto ya fue entregado al cliente?",
  };
  function choose(status: string) {
    startTransition(async () => {
      const form = new FormData();
      form.set("target", target); form.set("itemId", itemId); form.set("ticketId", ticketId ?? ""); form.set("status", status);
      try {
      const result = await (sale ? changeSaleItemLocation : advanceLogisticsStatusAction)(emptyActionState, form);
      setDialogError(result.error);
      setMessage(result.success);
      if (!result.error) { setSaved(status); setSelected(null); router.refresh(); }
      } catch { setDialogError("No pudimos guardar el estado. Intenta nuevamente."); }
    });
  }
  return <section className="sales-status-lights" aria-label="Estado del producto">
    <p><strong>Estado del producto</strong> · {cancelled ? "Cancelado" : LOGISTICS_STATUS_LABELS[saved ?? ""] ?? "Pendiente de confirmar"}</p>
    <div className="sales-status-buttons sales-no-print">{statuses.map((status, index) => <button key={status} type="button" aria-pressed={saved === status} disabled={pending || closed || !available || (!sale && !ticketId)} onClick={() => { setDialogError(null); setSelected(status); }}><span className={`sales-status-dot light-${index}`} aria-hidden="true" />{LOGISTICS_STATUS_LABELS[status]}</button>)}</div>
    <Dialog open={selected !== null} title="Confirmar estado del producto" onClose={() => { if (!pending) setSelected(null); }}>
      <div className="dialog-form">
        <p>{selected ? confirmation[selected] : ""}</p>
        {dialogError && <p className="form-message form-error" role="alert">{dialogError}</p>}
        <div className="admin-form-actions">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setSelected(null)}>Cancelar</Button>
          <Button type="button" variant="primary" disabled={pending} onClick={() => { if (selected) choose(selected); }}>{pending ? "Guardando…" : "Aceptar"}</Button>
        </div>
      </div>
    </Dialog>
    {!available && <p role="status">Para guardar estados, aplica database/migrations/018_sale_item_fulfillment.sql en Supabase.</p>}
    {!sale && !ticketId && <p className="admin-hint">Confirma el pedido para cambiar su estado.</p>}
    {!cancelled && saved === "READY_FOR_DELIVERY" && <p className="sales-pickup-message">Favor de agendar pickup.{!sale && <> <Link href="/admin/agenda">Agendar pickup</Link></>}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
