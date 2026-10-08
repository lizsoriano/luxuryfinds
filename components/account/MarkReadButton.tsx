"use client";

import { useActionState } from "react";
import { markNotificationsReadAction } from "../../app/cuenta/account-actions";
import { emptyActionState } from "../../lib/actions";

export function MarkReadButton({ id = "all", label }: { id?: string; label: string }) {
  const [state, action, pending] = useActionState(markNotificationsReadAction, emptyActionState);
  return (
    <form action={action} className="acc-mark-read">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="acc-text-button" disabled={pending}>{pending ? "Guardando…" : label}</button>
      {state.error && <span className="form-message form-error" role="alert">{state.error}</span>}
    </form>
  );
}
