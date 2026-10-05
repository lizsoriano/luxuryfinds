"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { centsToInput, formatQuantity } from "../../../lib/format";
import { updateVariantQuickAction } from "./actions";

type Status = "idle" | "saving" | "saved" | "error";

const SAVED_BADGE_MS = 1800;

/** What the input shows for a stored value: pesos with 2 decimals, or a plain quantity. */
function display(field: "price" | "stock", value: number) {
  return field === "price" ? centsToInput(value) : formatQuantity(value);
}

/**
 * Strict client-side reading of what was typed. The server re-validates with
 * parseMoneyToCents / parseQuantity; this only stops obvious garbage ("12a",
 * "1e5", "-3") from being sent and gives an immediate message instead.
 * Returns cents for price, units for stock, or null when invalid.
 */
function parseDraft(field: "price" | "stock", raw: string, allowsDecimal: boolean): number | null {
  const text = raw.replace(/[\s$,]/g, "");
  if (field === "price") {
    if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
    return Math.round(Number(text) * 100);
  }
  if (allowsDecimal ? !/^\d+(\.\d{0,3})?$/.test(text) : !/^\d+$/.test(text)) return null;
  return Number(text);
}

/**
 * One editable Stock or Precio cell. Saves on blur or Enter (never per
 * keystroke), Escape restores the saved value, and an unchanged value sends
 * nothing. Status sits in a fixed-width slot so the table never shifts.
 */
export function InlineVariantField({
  variantId,
  field,
  value,
  allowsDecimal = false,
  unitLabel,
  disabled = false,
  label,
  action = updateVariantQuickAction,
}: {
  variantId: string;
  field: "price" | "stock";
  /** Cents for price, units for stock. */
  value: number;
  allowsDecimal?: boolean;
  unitLabel?: string | null;
  disabled?: boolean;
  label: string;
  action?: (state: ActionState, data: FormData) => Promise<ActionState>;
}) {
  const [saved, setSaved] = useState(value);
  const [draft, setDraft] = useState(() => display(field, value));
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [lastServerValue, setLastServerValue] = useState(value);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focused, setFocused] = useState(false);

  // A fresh server value (after revalidation, or someone else's change) replaces
  // the local one — unless the admin is typing in this very field right now.
  if (value !== lastServerValue) {
    setLastServerValue(value);
    if (!focused && status !== "saving") {
      setSaved(value);
      setDraft(display(field, value));
    }
  }

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const fail = (text: string) => {
    setStatus("error");
    setMessage(text);
    setDraft(display(field, saved));
  };

  const commit = () => {
    if (disabled || status === "saving") return;
    const parsed = parseDraft(field, draft, allowsDecimal);
    if (parsed === null) {
      fail(
        field === "price"
          ? "Precio no válido."
          : allowsDecimal
            ? "Cantidad no válida."
            : "Solo números enteros.",
      );
      return;
    }
    if (parsed === saved) {
      setDraft(display(field, saved));
      return;
    }

    const formData = new FormData();
    formData.set("variantId", variantId);
    formData.set("field", field);
    formData.set("value", field === "price" ? centsToInput(parsed) : String(parsed));

    setStatus("saving");
    setMessage(null);
    setDraft(display(field, parsed));
    startTransition(async () => {
      let result;
      try {
        result = await action(emptyActionState, formData);
      } catch {
        result = { error: "Sin conexión. No se guardó.", success: null };
      }
      if (result.error) {
        fail(result.error);
        return;
      }
      setSaved(parsed);
      setStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus((current) => (current === "saved" ? "idle" : current)), SAVED_BADGE_MS);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur(); // blur commits
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(display(field, saved));
      setStatus("idle");
      setMessage(null);
    }
  };

  const fieldId = `${field}-${variantId}`;
  const suffix = field === "stock" && unitLabel ? unitLabel : null;

  return (
    <div className={`admin-inline-field admin-inline-${field}`} data-status={status}>
      <div className="admin-inline-control">
        {field === "price" ? (
          <span className="admin-inline-affix admin-inline-prefix" aria-hidden>
            $
          </span>
        ) : null}
        <input
          id={fieldId}
          className={`admin-inline-input${suffix ? " has-suffix" : ""}`}
          type="text"
          inputMode={field === "price" || allowsDecimal ? "decimal" : "numeric"}
          autoComplete="off"
          aria-label={label}
          aria-invalid={status === "error" || undefined}
          aria-describedby={message ? `${fieldId}-msg` : undefined}
          value={draft}
          disabled={disabled}
          title={disabled ? "Restaura el producto para editarlo" : undefined}
          readOnly={status === "saving"}
          onFocus={(event) => {
            setFocused(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            if (status === "error" || status === "saved") {
              setStatus("idle");
              setMessage(null);
            }
          }}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={onKeyDown}
        />
        {suffix ? (
          <span className="admin-inline-affix admin-inline-suffix" aria-hidden>
            {suffix}
          </span>
        ) : null}
        <span className="admin-inline-status" aria-hidden>
          {status === "saving" ? <span className="admin-inline-spinner" /> : status === "saved" ? "✓" : status === "error" ? "!" : null}
        </span>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "saving" ? "Guardando…" : status === "saved" ? "Guardado" : ""}
      </span>
      {message ? (
        <span id={`${fieldId}-msg`} className="admin-inline-message" role="alert">
          {message}
        </span>
      ) : null}
    </div>
  );
}
