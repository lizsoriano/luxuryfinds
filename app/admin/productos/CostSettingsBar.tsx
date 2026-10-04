"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { emptyActionState } from "../../../lib/actions";
import {
  MISSING_RATE_MESSAGE,
  STORE_COST_MIGRATION_FILE,
  USD_MXN_RATE_KEY,
  US_TAX_FACTOR_KEY,
  parseCostSetting,
  type CostSettingKey,
} from "../../../lib/supabase/store-cost";
import { updateCostSettingAction } from "./actions";

type Status = "idle" | "saving" | "saved" | "error";

const SAVED_BADGE_MS = 1800;

const display = (value: number | null) => (value === null ? "" : String(value));

/** One setting input: saves on blur / Enter, Escape restores, unchanged sends nothing. */
function SettingInput({
  settingKey,
  value,
  label,
  placeholder,
  width,
  warn,
}: {
  settingKey: CostSettingKey;
  value: number | null;
  label: string;
  placeholder?: string;
  width: number;
  warn?: boolean;
}) {
  const [saved, setSaved] = useState(value);
  const [draft, setDraft] = useState(() => display(value));
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [lastServerValue, setLastServerValue] = useState(value);
  const [, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (value !== lastServerValue) {
    setLastServerValue(value);
    if (!focused && status !== "saving") {
      setSaved(value);
      setDraft(display(value));
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
    setDraft(display(saved));
  };

  const commit = () => {
    if (status === "saving") return;
    if (!draft.trim() && saved === null) {
      setDraft("");
      return;
    }
    const parsed = parseCostSetting(settingKey, draft);
    if (!parsed.ok) {
      fail(parsed.error);
      return;
    }
    if (parsed.value === saved) {
      setDraft(display(saved));
      return;
    }
    const formData = new FormData();
    formData.set("key", settingKey);
    formData.set("value", String(parsed.value));
    setStatus("saving");
    setMessage(null);
    setDraft(display(parsed.value));
    startTransition(async () => {
      let result;
      try {
        result = await updateCostSettingAction(emptyActionState, formData);
      } catch {
        result = { error: "Sin conexión. No se guardó.", success: null };
      }
      if (result.error) {
        fail(result.error);
        return;
      }
      setSaved(parsed.value);
      setStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus((current) => (current === "saved" ? "idle" : current)), SAVED_BADGE_MS);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(display(saved));
      setStatus("idle");
      setMessage(null);
    }
  };

  const id = `cost-setting-${settingKey}`;
  return (
    <span className="admin-cost-setting" data-status={status} data-warn={warn && saved === null ? "true" : undefined}>
      <label htmlFor={id}>{label}</label>
      <span className="admin-inline-control">
        <input
          id={id}
          className="admin-inline-input"
          style={{ width }}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={status === "error" || undefined}
          aria-describedby={message ? `${id}-msg` : undefined}
          value={draft}
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
        <span className="admin-inline-status" aria-hidden>
          {status === "saving" ? <span className="admin-inline-spinner" /> : status === "saved" ? "✓" : status === "error" ? "!" : null}
        </span>
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "saving" ? "Guardando…" : status === "saved" ? "Guardado" : ""}
      </span>
      {message ? (
        <span id={`${id}-msg`} className="admin-cost-setting-error" role="alert">
          {message}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Compact bar above the product table: exchange rate and US tax factor used to
 * turn the "Costo tienda" in dollars into the peso cost. The rate has no
 * default — until it is captured the USD inputs stay disabled.
 */
export function CostSettingsBar({
  usdMxnRate,
  usTaxFactor,
  storeCostAvailable,
  loadError,
}: {
  usdMxnRate: number | null;
  usTaxFactor: number;
  storeCostAvailable: boolean;
  loadError: string | null;
}) {
  return (
    <div className="admin-cost-bar" role="group" aria-label="Ajustes para calcular el costo en pesos">
      <SettingInput
        settingKey={USD_MXN_RATE_KEY}
        value={usdMxnRate}
        label="Tipo de cambio USD→MXN"
        placeholder="Ej. 18.25"
        width={100}
        warn
      />
      <span className="admin-cost-bar-sep" aria-hidden>
        ·
      </span>
      <SettingInput settingKey={US_TAX_FACTOR_KEY} value={usTaxFactor} label="Tax" width={84} />
      {loadError ? (
        <span className="admin-cost-bar-note is-warn" role="alert">
          {loadError}
        </span>
      ) : !storeCostAvailable ? (
        <span className="admin-cost-bar-note is-warn">
          El costo en dólares se activa al aplicar <code>{STORE_COST_MIGRATION_FILE.split("/").pop()}</code> en Supabase.
        </span>
      ) : usdMxnRate === null ? (
        <span className="admin-cost-bar-note is-warn">{MISSING_RATE_MESSAGE}</span>
      ) : (
        <span className="admin-cost-bar-note">Cambiarlo no recalcula los costos ya guardados.</span>
      )}
    </div>
  );
}
