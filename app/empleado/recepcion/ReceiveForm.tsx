"use client";
import { useActionState } from "react";
import { emptyActionState } from "../../../lib/actions";
import { receiveStaffLineAction } from "./actions";

export function ReceiveForm({ shipmentId, lineId, pendingQuantity }: { shipmentId: string; lineId: string; pendingQuantity: number }) {
  const [state, action, busy] = useActionState(receiveStaffLineAction, emptyActionState);
  const received = pendingQuantity <= 0 || Boolean(state.success);
  return <form action={action} className="dialog-form">
    <input type="hidden" name="shipmentId" value={shipmentId} />
    <input type="hidden" name="lineId" value={lineId} />
    <label className="staff-reception-check">
      <input type="checkbox" name="received" value="yes" checked={received || busy} disabled={received || busy}
        onChange={(event) => { if (event.currentTarget.checked) event.currentTarget.form?.requestSubmit(); }} />
      <span>{busy ? "Confirmando…" : received ? "Recibido" : "Confirmar recibido"}</span>
    </label>
    {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
    {state.success && <p className="form-message form-success" role="status">{state.success}</p>}
  </form>;
}
