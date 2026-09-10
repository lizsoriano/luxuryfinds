"use client";

import { useActionState, useState } from "react";
import { emptyActionState, type ActionState } from "../../lib/actions";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * Destructive actions (archive / restore / cancel) always go through a
 * confirmation dialog. The trigger button is a real submit path: it opens the
 * dialog, and the dialog runs the server action.
 */
export function ConfirmAction({
  action,
  fields,
  triggerLabel,
  triggerIcon,
  title,
  description,
  confirmLabel = "Confirmar",
  variant = "secondary",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  triggerLabel: string;
  /** When set, the trigger renders as an icon-only button (triggerLabel becomes its aria-label/title). */
  triggerIcon?: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "primary" | "secondary" | "accent" | "danger";
}) {
  const [open, setOpen] = useState(false);
  // The dialog closes from inside the action itself: running the server action
  // is the event, so there is nothing here for an effect to synchronise.
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await action(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      {triggerIcon ? (
        <button
          type="button"
          className="admin-icon-btn"
          aria-label={triggerLabel}
          title={triggerLabel}
          onClick={() => setOpen(true)}
        >
          {triggerIcon}
        </button>
      ) : (
        <Button type="button" variant={variant} size="small" onClick={() => setOpen(true)}>
          {triggerLabel}
        </Button>
      )}
      <Dialog open={open} title={title} onClose={() => setOpen(false)}>
        <form action={formAction} className="dialog-form">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <p className="admin-hint">{description}</p>
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant={variant} size="small" disabled={pending}>
              {pending ? "Procesando…" : confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
