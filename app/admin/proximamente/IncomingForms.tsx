"use client";
import { useActionState, useState } from "react";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { centsToInput, formatMoney } from "../../../lib/format";
import { compressPhoto } from "../compras/compress-photo";
import { saveIncomingOfferAction } from "./actions";
import { createReservationAction } from "../apartados/actions";
import type { IncomingItem } from "../../../lib/supabase/incoming-reservations";
function Message({ state }: { state: ActionState }) { return <>{state.error && <p className="form-message form-error" role="alert">{state.error}</p>}{state.success && <p className="form-message form-success" role="status">{state.success}</p>}</>; }
export function OfferForm({ item }: { item: IncomingItem }) {
  const [state, action, pending] = useActionState(async (previous: ActionState, data: FormData) => {
    try { const photo = data.get("photo"); if (photo instanceof File && photo.size) data.set("photo", await compressPhoto(photo)); return await saveIncomingOfferAction(previous, data); }
    catch (error) { return { success: null, error: error instanceof Error ? error.message : "No se pudo preparar la foto." }; }
  }, emptyActionState);
  return <form action={action} className="dialog-form"><input type="hidden" name="itemId" value={item.purchase_item_id} />
    <div className="admin-form-grid"><label className="field"><span>Precio de venta por pieza (MXN)</span><input className="input" name="price" inputMode="decimal" defaultValue={item.unit_price_cents ? centsToInput(item.unit_price_cents) : ""} required /></label><label className="field"><span>Llegada estimada</span><input className="input" type="date" name="eta" defaultValue={item.estimated_arrival ?? ""} /></label></div>
    <label className="field"><span>Foto nueva (opcional, se reduce automáticamente)</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label><label className="checkbox-field"><input type="checkbox" name="published" defaultChecked={Boolean(item.is_public)} /> Publicar en Próximamente</label>
    <Message state={state} /><button className="button button-secondary button-small" disabled={pending}>{pending ? "Guardando…" : "Guardar publicación"}</button>
  </form>;
}
export function ReservationForm({ item, clients, requestId }: { item: IncomingItem; clients: Array<{ id: string; label: string }>; requestId: string }) {
  const [quantity, setQuantity] = useState(1);
  const [state, action, pending] = useActionState(createReservationAction, emptyActionState);
  const total = BigInt(item.unit_price_cents ?? 0) * BigInt(Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
  return <details className="incoming-reserve"><summary className="button button-primary button-small">Registrar apartado</summary><form action={action} className="dialog-form">
    <input type="hidden" name="itemId" value={item.purchase_item_id} /><input type="hidden" name="requestId" value={requestId} />
    <label className="field"><span>Clienta</span><select className="input" name="clientId" required defaultValue=""><option value="" disabled>Selecciona una clienta</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}</select></label>
    <div className="admin-form-grid"><label className="field"><span>Piezas</span><input className="input" name="quantity" type="number" min={1} max={Math.min(9999, item.available_quantity)} step={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} required /></label><label className="field"><span>Anticipo recibido (opcional: por defecto 50 %)</span><input className="input" name="initial" inputMode="decimal" placeholder={centsToInput(Number((total + BigInt(1)) / BigInt(2)))} /></label></div>
    <p className="admin-hint">Total {formatMoney(Number(total))}. Plazo: un mes de calendario desde hoy. Si no se liquida, se notifica a la clienta y se libera la pieza.</p>
    <label className="field"><span>Método del anticipo confirmado</span><select className="input" name="method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia confirmada</option></select></label><label className="field"><span>Referencia (opcional)</span><input className="input" name="reference" maxLength={300} /></label>
    <p className="admin-hint">Registra solo dinero que ya recibiste y verificaste. Los comprobantes pendientes se aprueban en Cobranza.</p><Message state={state} /><button className="button button-primary" disabled={pending || !item.available_quantity || !item.unit_price_cents || Boolean(state.success)}>{pending ? "Registrando…" : state.success ? "Apartado registrado" : "Confirmar apartado y anticipo"}</button>
  </form></details>;
}
