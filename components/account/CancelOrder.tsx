"use client";

import { useActionState, useEffect, useState } from "react";
import { cancelOwnOrderAction } from "../../app/cuenta/compras/actions";
import { emptyActionState } from "../../lib/actions";

/** Lets a client cancel her own order while the owner has not confirmed it yet. */
export function CancelOrder({ orderId, onCancelled }: { orderId: string; onCancelled?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(cancelOwnOrderAction, emptyActionState);
  const done = Boolean(state.success);
  useEffect(() => {
    if (done) onCancelled?.();
    // onCancelled is a fresh function on every parent render; only the outcome matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return (
    <div className="acc-cancel">
      {!confirming ? (
        <button type="button" className="acc-text-button is-danger" onClick={() => setConfirming(true)}>Cancelar pedido</button>
      ) : (
        <form action={action} className="acc-cancel-confirm">
          <input type="hidden" name="orderId" value={orderId} />
          <p>¿Cancelar este pedido? Aún no lo confirmamos, así que no se realizó ningún cobro.</p>
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
