"use client";
import { useActionState } from "react";
import { emptyActionState } from "../../../lib/actions";
import { compressPhoto } from "../../admin/compras/compress-photo";
import { receiveStaffLineAction } from "./actions";
export function ReceiveForm({ shipmentId, lineId, pendingQuantity }: { shipmentId: string; lineId: string; pendingQuantity: number }) {
  const [state, action, busy] = useActionState(async (previous: typeof emptyActionState, data: FormData) => {
    try { const photo = data.get("photo"); if (photo instanceof File && photo.size) data.set("photo", await compressPhoto(photo)); return await receiveStaffLineAction(previous, data); }
    catch (error) { return { success: null, error: error instanceof Error ? error.message : "No se pudo preparar la foto." }; }
  }, emptyActionState);
  return <form action={action} className="dialog-form"><input type="hidden" name="shipmentId" value={shipmentId} /><input type="hidden" name="lineId" value={lineId} />
    <div className="admin-form-grid">{[["good", "Buenas"], ["damaged", "Dañadas"], ["missing", "Faltantes"]].map(([name, label]) => <label className="field" key={name}><span>{label}</span><input className="input" type="number" name={name} min={0} max={pendingQuantity} step={1} defaultValue={0} required /></label>)}</div>
    <p className="admin-hint">Quedan {pendingQuantity} pieza(s). Lo que no captures queda pendiente para otra recepción.</p>
    <label className="field"><span>Observaciones</span><textarea className="input" name="notes" maxLength={1000} /></label><label className="field"><span>Foto (opcional, se reduce automáticamente)</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></label>
    {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}{state.success && <p className="form-message form-success" role="status">{state.success}</p>}
    <button className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Registrar recepción"}</button>
  </form>;
}
