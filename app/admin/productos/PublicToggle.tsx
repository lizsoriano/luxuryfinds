"use client";

import { useState, useTransition } from "react";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { setProductPublicAction } from "./actions";

/**
 * The Visible / Oculto chip of the Catálogo column, as a button: one click
 * shows or hides the product. The server refuses to publish a product whose
 * price is $0 and says so under the chip. (Archived products keep a read-only
 * badge; ProductsTable never renders this for them.)
 */
export function PublicToggle({ productId, productName, isPublic }: { productId: string; productName: string; isPublic: boolean }) {
  const [current, setCurrent] = useState(isPublic);
  const [lastServerValue, setLastServerValue] = useState(isPublic);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (isPublic !== lastServerValue) {
    setLastServerValue(isPublic);
    if (!saving) setCurrent(isPublic);
  }

  const toggle = () => {
    if (saving) return;
    const next = !current;
    const formData = new FormData();
    formData.set("id", productId);
    formData.set("public", next ? "true" : "false");
    setSaving(true);
    setMessage(null);
    startTransition(async () => {
      let result: ActionState;
      try {
        result = await setProductPublicAction(emptyActionState, formData);
      } catch {
        result = { error: "Sin conexión. No se guardó.", success: null };
      }
      setSaving(false);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setCurrent(next);
    });
  };

  const stateLabel = current ? "Visible" : "Oculto";
  const actionLabel = current ? "ocultarlo del catálogo" : "hacerlo visible en el catálogo";
  const messageId = `public-${productId}-msg`;

  return (
    <div className="admin-public-toggle">
      <button
        type="button"
        className={`badge ${current ? "badge-success" : "badge-warning"} admin-badge-button`}
        onClick={toggle}
        disabled={saving}
        aria-busy={saving || undefined}
        aria-label={`${stateLabel}: ${productName}. Clic para ${actionLabel}.`}
        aria-describedby={message ? messageId : undefined}
        title={`Clic para ${actionLabel}`}
        data-saving={saving || undefined}
      >
        {saving ? "Guardando…" : stateLabel}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {saving ? "Guardando…" : ""}
      </span>
      {message ? (
        <span id={messageId} className="admin-public-toggle-error" role="alert">
          {message}
        </span>
      ) : null}
    </div>
  );
}
