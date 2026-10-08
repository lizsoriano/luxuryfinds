"use client";
import { useActionState, useState } from "react";
import { emptyActionState } from "../../../lib/actions";
import { saveSalesNotes, changeSalesTracking } from "./sales-actions";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";

export function PrintSale() { return <button type="button" className="button button-secondary button-small sales-no-print" onClick={() => window.print()}>Imprimir</button>; }
export function SalesNotes({ target, notes }: { target: string; notes: string | null }) {
  const [state, action, pending] = useActionState(saveSalesNotes, emptyActionState);
  const [editing, setEditing] = useState(false);
  return <><div className="section-heading"><h2>Tus notas</h2><button type="button" className="sales-text-button sales-no-print" onClick={() => setEditing(!editing)}>{editing ? "Cerrar" : "Editar"}</button></div>
    {editing ? <form action={action}><input type="hidden" name="target" value={target} /><label htmlFor="sales-notes" className="sr-only">Notas internas</label><textarea id="sales-notes" name="notes" defaultValue={notes ?? ""} rows={4} maxLength={5000} /><button type="submit" className="button button-primary button-small" disabled={pending}>{pending ? "Guardando…" : "Guardar notas"}</button>{state.error && <p className="form-message form-error" role="alert">{state.error}</p>}{state.success && <p className="form-message" role="status">{state.success}</p>}</form> : <p className="sales-notes-text">{notes || "Agrega una nota para organizar esta venta."}</p>}</>;
}
export function SalesTracking({ target, token, unavailable }: { target: string; token: string | null; unavailable: boolean }) {
  const [state, action, pending] = useActionState(changeSalesTracking, emptyActionState);
  const [copyStatus, setCopyStatus] = useState("");
  const path = token ? `/seguimiento/${token}` : null;
  async function copy() {
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); setCopyStatus("Enlace copiado."); }
    catch { setCopyStatus("No pudimos copiarlo. Abre el seguimiento y copia su dirección."); }
  }
  return <div className="sales-no-print"><h2>Página de seguimiento</h2><p className="admin-hint">Comparte esta página con tu cliente para que pueda seguir la compra.</p>
    {unavailable ? <p className="form-message">Aplica database/migrations/017_sales_feed_tracking.sql para activar los enlaces.</p> : path ? <><div className="sales-control-row"><button type="button" className="button button-secondary button-small" onClick={copy}>Copiar link</button><a className="sales-link" href={path} target="_blank" rel="noreferrer">Acceder ↗</a></div><div className="sales-control-row"><ConfirmAction action={changeSalesTracking} fields={{ target, mode: "regenerate" }} triggerLabel="Regenerar" title="Regenerar enlace" description="El enlace anterior dejará de funcionar. Comparte el nuevo con tu cliente." /><ConfirmAction action={changeSalesTracking} fields={{ target, mode: "revoke" }} triggerLabel="Desactivar" title="Desactivar seguimiento" description="Las personas que tengan este enlace ya no podrán consultar la compra." /></div></> : <form action={action}><input type="hidden" name="target" value={target} /><input type="hidden" name="mode" value="create" /><button type="submit" className="button button-secondary button-small" disabled={pending}>{pending ? "Creando…" : "Crear enlace"}</button></form>}
    {copyStatus && <p role="status" className="admin-hint">{copyStatus}</p>}{state.error && <p role="alert" className="form-message form-error">{state.error}</p>}{state.success && <p role="status" className="form-message">{state.success}</p>}</div>;
}
