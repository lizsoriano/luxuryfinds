"use client";

import { useActionState } from "react";
import { emptyActionState, type ActionState } from "../../lib/actions";

/**
 * A single icon button that runs a server action immediately on click — no
 * confirmation dialog, for actions that are safe/reversible (duplicate).
 * Destructive actions should use ConfirmAction instead.
 */
export function IconAction({
  action,
  fields,
  label,
  icon,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  icon: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, emptyActionState);

  return (
    <form action={formAction} className="admin-icon-form">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className="admin-icon-btn" aria-label={label} title={label} disabled={pending}>
        {icon}
      </button>
      {state.error && (
        <span className="admin-icon-form-error" role="alert">
          {state.error}
        </span>
      )}
      {state.success && <span className="admin-icon-form-success">{state.success}</span>}
    </form>
  );
}
