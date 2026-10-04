"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input, Select, Textarea } from "../../../components/ui/Fields";
import { centsToInput, formatMoney } from "../../../lib/format";
import { formatUsd } from "../../../lib/supabase/purchase-math";
import { confirmPurchaseAction, registerPaymentAction, voidPaymentAction } from "./actions";
import { FormMessage, useActionForm } from "./form-kit";

export type ConfirmPreview = {
  totalRealUsdCents: number;
  commissionPercent: number;
  commissionUsdCents: number;
  owedUsdCents: number;
  exchangeRateLabel: string;
  owedMxnCents: number;
};

/**
 * "Confirmar compra": shows what will be frozen, lists what still blocks it,
 * warns (without blocking) about tickets with no photo, and asks for the
 * explicit "Confirmo la diferencia" when a ticket does not square.
 */
export function ConfirmPurchaseDialog({
  purchaseId,
  preview,
  blockers,
  differences,
  missingPhotos,
}: {
  purchaseId: string;
  preview: ConfirmPreview | null;
  blockers: string[];
  differences: Array<{ storeName: string; differenceUsdCents: number }>;
  missingPhotos: string[];
}) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const { state, pending, onSubmit, reset } = useActionForm(confirmPurchaseAction, {
    onSuccess: () => setOpen(false),
  });
  const needsAck = differences.length > 0;
  const netDifference = differences.reduce((sum, item) => sum + item.differenceUsdCents, 0);

  return (
    <>
      <Button
        type="button"
        size="small"
        onClick={() => {
          reset();
          setAcknowledged(false);
          setOpen(true);
        }}
      >
        Confirmar compra
      </Button>
      <Dialog open={open} title="Confirmar compra" onClose={() => setOpen(false)} className="dialog-wide">
        <form onSubmit={onSubmit} className="dialog-form">
          <input type="hidden" name="id" value={purchaseId} />
          {blockers.length ? (
            <div className="admin-notice">
              <strong>Todavía no se puede confirmar:</strong>
              <ul className="shopper-plain-list">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview ? (
            <dl className="shopper-totals">
              <div>
                <dt>Total de los tickets con tax</dt>
                <dd>{formatUsd(preview.totalRealUsdCents)}</dd>
              </div>
              <div>
                <dt>Comisión {preview.commissionPercent} %</dt>
                <dd>{formatUsd(preview.commissionUsdCents)}</dd>
              </div>
              <div>
                <dt>Le debes al shopper</dt>
                <dd>{formatUsd(preview.owedUsdCents)}</dd>
              </div>
              <div className="shopper-totals-strong">
                <dt>En pesos (TC {preview.exchangeRateLabel})</dt>
                <dd>{formatMoney(preview.owedMxnCents)}</dd>
              </div>
            </dl>
          ) : null}
          {missingPhotos.length ? (
            <p className="admin-hint shopper-warning">
              Sin foto del ticket: {missingPhotos.join(", ")}. Puedes confirmar igual; la foto no se podrá agregar después.
            </p>
          ) : null}
          {needsAck && !blockers.length ? (
            <div className="admin-notice">
              <strong>Hay tickets que no cuadran (diferencia neta {formatUsd(netDifference)}).</strong>
              {differences.map((item) => (
                <span key={item.storeName} className="shopper-diff-line">
                  {item.storeName}: {item.differenceUsdCents > 0 ? "falta capturar" : "sobra"} {formatUsd(Math.abs(item.differenceUsdCents))}
                </span>
              ))}
              <label className="admin-switch shopper-ack" htmlFor="ack-difference">
                <input
                  id="ack-difference"
                  type="checkbox"
                  name="acknowledgeDifference"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  Confirmo la diferencia
                  <small>Se paga lo que dicen los tickets; la diferencia queda registrada en la compra.</small>
                </span>
              </label>
            </div>
          ) : null}
          <p className="admin-hint">
            Al confirmar se congelan los montos, cada artículo queda como <strong>comprado, pendiente de envío</strong> con su
            costo en pesos, y la compra ya no se puede editar (solo registrar abonos).
          </p>
          <FormMessage state={{ error: state.error, success: null }} />
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending || blockers.length > 0 || (needsAck && !acknowledged)}>
              {pending ? "Confirmando…" : "Confirmar y congelar montos"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

const METHOD_OPTIONS = [
  { value: "TRANSFER", label: "Transferencia" },
  { value: "CASH", label: "Efectivo" },
  { value: "OTHER", label: "Otro" },
];

/**
 * Abono to a shopper. With `purchaseId` it is tied to that confirmed purchase
 * (and cannot exceed its pending balance); without it, it is a general abono
 * that only counts in the shopper's overall balance (advances, lump sums).
 */
export function PaymentDialog({
  supplierId,
  supplierName,
  purchaseId,
  pendingMxnCents,
  today,
  triggerLabel,
  triggerVariant = "primary",
}: {
  supplierId: string;
  supplierName: string;
  purchaseId?: string;
  pendingMxnCents?: number | null;
  today: string;
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, reset } = useActionForm(registerPaymentAction, {
    onSuccess: () => setOpen(false),
  });
  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size="small"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
      <Dialog open={open} title={purchaseId ? "Registrar abono de la compra" : `Abono general a ${supplierName}`} onClose={() => setOpen(false)}>
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            <input type="hidden" name="supplierId" value={supplierId} />
            {purchaseId ? <input type="hidden" name="purchaseId" value={purchaseId} /> : null}
            <p className="admin-hint">
              {purchaseId
                ? `Saldo pendiente de esta compra: ${formatMoney(pendingMxnCents ?? 0)}.`
                : "No se liga a una compra: descuenta del saldo total con este shopper (por ejemplo, un adelanto)."}
            </p>
            <label className="field" htmlFor="payment-amount">
              <span>Monto en pesos (MXN) *</span>
              <input
                id="payment-amount"
                className="input"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={purchaseId && pendingMxnCents && pendingMxnCents > 0 ? centsToInput(pendingMxnCents) : ""}
                autoComplete="off"
                required
              />
            </label>
            <Input id="payment-date" name="paidOn" label="Fecha *" type="date" max={today} defaultValue={today} required />
            <Select id="payment-method" name="method" label="Método *" defaultValue="TRANSFER">
              {METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Textarea id="payment-note" name="note" label="Nota" rows={2} maxLength={500} placeholder="Opcional: referencia, banco…" />
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="small" disabled={pending}>
                {pending ? "Registrando…" : "Registrar abono"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

const VoidIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" strokeLinecap="round" />
  </svg>
);

/** An abono is never edited: it is voided with a reason and stays in the list, crossed out. */
export function VoidPaymentDialog({ paymentId, amountMxnCents }: { paymentId: string; amountMxnCents: number }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, reset } = useActionForm(voidPaymentAction, { onSuccess: () => setOpen(false) });
  return (
    <>
      <button
        type="button"
        className="admin-icon-btn"
        aria-label={`Anular abono de ${formatMoney(amountMxnCents)}`}
        title="Anular abono"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <VoidIcon />
      </button>
      <Dialog open={open} title="Anular abono" onClose={() => setOpen(false)}>
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            <input type="hidden" name="paymentId" value={paymentId} />
            <p className="admin-hint">
              El abono de {formatMoney(amountMxnCents)} deja de contar en el saldo, pero se queda en la lista como anulado. Si el
              monto estaba mal, anúlalo y registra uno nuevo.
            </p>
            <Textarea id={`void-${paymentId}`} name="reason" label="Motivo *" rows={2} maxLength={500} required />
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger" size="small" disabled={pending}>
                {pending ? "Anulando…" : "Anular abono"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
