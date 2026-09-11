"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Select } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { formatMoney, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "../../../lib/format";
import { convertQuoteToSaleAction } from "./actions";

/**
 * Converting to a venta needs one thing ConfirmAction cannot carry: how the
 * client paid. Everything else (the guard, the stock check, the cash-drawer
 * note) lives in convertQuoteToSaleAction.
 */
export function ConvertToSaleDialog({
  quoteId,
  totalCents,
  hasOpenCashSession,
}: {
  quoteId: string;
  totalCents: number;
  hasOpenCashSession: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await convertQuoteToSaleAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant="accent" size="small" onClick={() => setOpen(true)}>
        Convertir a venta
      </Button>
      <Dialog open={open} title="Convertir en venta" onClose={() => setOpen(false)}>
        <form action={formAction} className="dialog-form">
          <input type="hidden" name="id" value={quoteId} />
          <p className="admin-hint">
            Se registra una venta directa por {formatMoney(totalCents)} con los precios cotizados y se descuenta el
            inventario de inmediato. Úsalo solo si la clienta se lleva los artículos ahora; si hay que encargarlos,
            conviértela en pedido.
          </p>
          {!hasOpenCashSession && (
            <p className="admin-hint">
              No hay una caja abierta, así que esta venta no entrará en el corte de caja de hoy.
            </p>
          )}
          <Select id="quote-sale-method" name="paymentMethod" label="Método de pago" defaultValue="CASH">
            {PAYMENT_METHODS.map((method) => (
              <option value={method} key={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="accent" size="small" disabled={pending}>
              {pending ? "Registrando…" : "Registrar venta"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
