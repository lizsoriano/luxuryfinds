"use client";

import { useActionState, useState } from "react";
import { cancelDeliveryAction } from "../../app/cuenta/entregas/actions";
import { emptyActionState } from "../../lib/actions";

export function CancelAppointment({ bookingIds }: { bookingIds: string[] }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(cancelDeliveryAction, emptyActionState);
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return (
    <div className="acc-cancel">
      {!confirming ? (
        <button type="button" className="acc-text-button is-danger" onClick={() => setConfirming(true)}>Cancelar cita</button>
      ) : (
        <form action={action} className="acc-cancel-confirm">
          {bookingIds.map((id) => <input key={id} type="hidden" name="bookingId" value={id} />)}
          <p>¿Cancelar esta cita? Tu pedido seguirá listo para agendar otra.</p>
          <div>
            <button type="submit" className="button button-danger acc-btn" disabled={pending}>{pending ? "Cancelando…" : "Sí, cancelar"}</button>
            <button type="button" className="button button-secondary acc-btn" onClick={() => setConfirming(false)} disabled={pending}>No, mantener</button>
          </div>
        </form>
      )}
      {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
    </div>
  );
}
