"use client";

import { useActionState } from "react";
import { emptyActionState, type ActionState } from "../../../../lib/actions";
import { Button } from "../../../../components/ui/Button";

/**
 * Runs the same synchronisation the cron runs, for one store, and shows what it
 * did. A manual run takes a bounded slice of the catalogue so the request can
 * answer; the message says so when the run comes back partial.
 */
export function SyncNowButton({
  action,
  source,
  label,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  source: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyActionState);

  return (
    // Inline layout on purpose: app/globals.css is shared with the rest of the
    // panel and this screen does not need a new global class for one form.
    <form action={formAction} style={{ display: "grid", gap: 8, margin: 0 }}>
      <input type="hidden" name="source" value={source} />
      <Button type="submit" size="small" disabled={pending}>
        {pending ? "Sincronizando…" : `Sincronizar ${label} ahora`}
      </Button>
      {state.error && (
        <p className="form-message form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="form-message form-success" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}
