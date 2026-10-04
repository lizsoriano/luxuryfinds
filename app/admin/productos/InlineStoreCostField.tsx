"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { emptyActionState } from "../../../lib/actions";
import { centsToInput, formatMoney } from "../../../lib/format";
import { COMMISSION_OPTIONS, parseUsdToCents, type StoreCostActionState } from "../../../lib/supabase/store-cost";
import { updateVariantQuickAction } from "./actions";

type Status = "idle" | "saving" | "saved" | "error";
type Saved = { usdCents: number | null; commission: number; costCents: number };

const SAVED_BADGE_MS = 1800;

const usdDisplay = (cents: number | null) => (cents === null ? "" : centsToInput(cents));

/**
 * "Costo tienda" cell: the US store cost (US$) plus the commission she was
 * charged (Sin / 10% / 15%). Same saving behaviour as Stock / Precio — blur or
 * Enter saves, Escape restores, unchanged sends nothing — and changing only the
 * commission saves too. The peso cost underneath is always the one the server
 * calculated and returned; the browser never works it out.
 *
 * Saves go through a small queue so a USD save (on blur) followed right away by
 * a commission change reach the server in order, each one reading the other's
 * stored value.
 */
export function InlineStoreCostField({
  variantId,
  usdCents,
  commissionPercent,
  costCents,
  disabled = false,
  disabledReason,
  disabledHint,
  label,
}: {
  variantId: string;
  usdCents: number | null;
  commissionPercent: number;
  costCents: number;
  disabled?: boolean;
  /** Tooltip on the disabled controls. */
  disabledReason?: string;
  /** Short line shown instead of the peso cost when disabled for a setup reason. */
  disabledHint?: string;
  label: string;
}) {
  const [saved, setSaved] = useState<Saved>({ usdCents, commission: commissionPercent, costCents });
  const [draft, setDraft] = useState(() => usdDisplay(usdCents));
  const [commission, setCommission] = useState(commissionPercent);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  // A fresh server value (after revalidation) replaces the local one, unless
  // the admin is typing here or a save is still on its way.
  const serverKey = `${usdCents}|${commissionPercent}|${costCents}`;
  const [lastServerKey, setLastServerKey] = useState(serverKey);
  if (serverKey !== lastServerKey) {
    setLastServerKey(serverKey);
    if (!focused && status !== "saving") {
      setSaved({ usdCents, commission: commissionPercent, costCents });
      setDraft(usdDisplay(usdCents));
      setCommission(commissionPercent);
    }
  }

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const send = (field: "store_cost" | "commission", value: string, revert: () => void) => {
    const formData = new FormData();
    formData.set("variantId", variantId);
    formData.set("field", field);
    formData.set("value", value);

    pending.current += 1;
    setStatus("saving");
    setMessage(null);
    queue.current = queue.current.then(
      () =>
        new Promise<void>((resolve) => {
          startTransition(async () => {
            let result: StoreCostActionState;
            try {
              result = await updateVariantQuickAction(emptyActionState, formData);
            } catch {
              result = { error: "Sin conexión. No se guardó.", success: null };
            }
            pending.current -= 1;
            if (result.error) {
              revert();
              setStatus("error");
              setMessage(result.error);
            } else {
              if (result.variant) {
                const next = {
                  usdCents: result.variant.storeCostUsdCents,
                  commission: result.variant.commissionPercent,
                  costCents: result.variant.costCents,
                };
                setSaved(next);
                setCommission(next.commission);
                if (pending.current === 0) setDraft(usdDisplay(next.usdCents));
              }
              if (pending.current === 0) {
                setStatus("saved");
                if (savedTimer.current) clearTimeout(savedTimer.current);
                savedTimer.current = setTimeout(
                  () => setStatus((current) => (current === "saved" ? "idle" : current)),
                  SAVED_BADGE_MS,
                );
              }
            }
            resolve();
          });
        }),
    );
  };

  const commitUsd = () => {
    if (disabled) return;
    const parsed = parseUsdToCents(draft);
    if (parsed !== null && Number.isNaN(parsed)) {
      setStatus("error");
      setMessage("Costo no válido.");
      setDraft(usdDisplay(saved.usdCents));
      return;
    }
    if (parsed === saved.usdCents) {
      setDraft(usdDisplay(saved.usdCents));
      return;
    }
    const previous = saved.usdCents;
    setDraft(usdDisplay(parsed));
    send("store_cost", parsed === null ? "" : centsToInput(parsed), () => setDraft(usdDisplay(previous)));
  };

  const changeCommission = (next: number) => {
    if (disabled || next === commission) return;
    const previous = commission;
    setCommission(next);
    send("commission", String(next), () => setCommission(previous));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur(); // blur commits
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(usdDisplay(saved.usdCents));
      setStatus("idle");
      setMessage(null);
    }
  };

  const fieldId = `store-cost-${variantId}`;
  const showHint = disabled && disabledHint;

  return (
    <div className="admin-inline-field admin-inline-cost" data-status={status}>
      <div className="admin-inline-cost-row">
        <div className="admin-inline-control">
          <span className="admin-inline-affix admin-inline-prefix" aria-hidden>
            US$
          </span>
          <input
            id={fieldId}
            className="admin-inline-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Costo en tienda (dólares) de ${label}`}
            aria-invalid={status === "error" || undefined}
            aria-describedby={`${fieldId}-mxn${message ? ` ${fieldId}-msg` : ""}`}
            value={draft}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
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
              commitUsd();
            }}
            onKeyDown={onKeyDown}
          />
          <span className="admin-inline-status" aria-hidden>
            {status === "saving" ? <span className="admin-inline-spinner" /> : status === "saved" ? "✓" : status === "error" ? "!" : null}
          </span>
        </div>
        <select
          className="admin-inline-select"
          aria-label={`Comisión que te cobraron por ${label}`}
          title={disabled ? disabledReason : "Comisión sobre el total con tax"}
          value={String(commission)}
          disabled={disabled}
          onChange={(event) => changeCommission(Number(event.target.value))}
        >
          {COMMISSION_OPTIONS.map((option) => (
            <option value={option} key={option}>
              {option === 0 ? "Sin" : `${option}%`}
            </option>
          ))}
        </select>
      </div>
      <span id={`${fieldId}-mxn`} className={`admin-inline-cost-mxn${showHint ? " is-hint" : ""}`}>
        {showHint
          ? disabledHint
          : saved.usdCents !== null
            ? `= ${formatMoney(saved.costCents)} MXN`
            : saved.costCents > 0
              ? `Costo ${formatMoney(saved.costCents)}`
              : "Sin costo"}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "saving" ? "Guardando…" : status === "saved" ? `Guardado. Costo ${formatMoney(saved.costCents)}` : ""}
      </span>
      {message ? (
        <span id={`${fieldId}-msg`} className="admin-inline-message" role="alert">
          {message}
        </span>
      ) : null}
    </div>
  );
}
