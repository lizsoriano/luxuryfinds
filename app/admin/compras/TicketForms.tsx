"use client";

import { useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input } from "../../../components/ui/Fields";
import { formatMoney } from "../../../lib/format";
import { formatUsd, usdCentsToInput } from "../../../lib/supabase/purchase-math";
import { saveItemAction, saveTicketAction, type PurchaseActionState } from "./actions";
import { FormMessage, PhotoField, useActionForm, usePhoto } from "./form-kit";

export type TicketFormValues = {
  id: string;
  store_name: string;
  reference: string | null;
  tax_usd_cents: number;
  real_total_usd_cents: number | null;
  hasPhoto: boolean;
  photoUrl: string | null;
};

/**
 * Add / edit a store ticket. The same dialog squares it: the total WITH tax
 * printed on the receipt and its photo are optional here, so a ticket can be
 * opened at the register and squared later.
 */
export function TicketDialog({
  purchaseId,
  ticket,
  storeSuggestions,
  triggerLabel,
  triggerVariant = "secondary",
}: {
  purchaseId: string;
  ticket?: TicketFormValues;
  storeSuggestions: string[];
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const photo = usePhoto();
  const idPrefix = `ticket-${ticket?.id ?? "new"}`;
  const { state, pending, onSubmit, reset } = useActionForm<PurchaseActionState>(saveTicketAction, {
    prepare: photo.attach,
    onSuccess: (_next, form) => {
      form.reset();
      photo.clear();
      setOpen(false);
    },
  });
  const close = () => {
    photo.clear();
    reset();
    setOpen(false);
  };

  return (
    <>
      <Button type="button" variant={triggerVariant} size="small" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} title={ticket ? `Ticket de ${ticket.store_name}` : "Nuevo ticket de tienda"} onClose={close}>
        <form onSubmit={onSubmit} className="dialog-form">
          <input type="hidden" name="purchaseId" value={purchaseId} />
          {ticket ? <input type="hidden" name="ticketId" value={ticket.id} /> : null}
          <Input
            id={`${idPrefix}-store`}
            name="storeName"
            label="Tienda *"
            list={`${idPrefix}-stores`}
            defaultValue={ticket?.store_name ?? ""}
            placeholder="Sephora, Ulta, Bath & Body Works…"
            autoComplete="off"
            required
          />
          <datalist id={`${idPrefix}-stores`}>
            {storeSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Input
            id={`${idPrefix}-reference`}
            name="reference"
            label="Referencia del ticket"
            defaultValue={ticket?.reference ?? ""}
            placeholder="Opcional: número de ticket o sucursal"
            autoComplete="off"
          />
          <div className="shopper-two-cols">
            <label className="field" htmlFor={`${idPrefix}-tax`}>
              <span>Tax del ticket (US$)</span>
              <input
                id={`${idPrefix}-tax`}
                className="input"
                name="tax"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={ticket ? usdCentsToInput(ticket.tax_usd_cents) : ""}
                autoComplete="off"
              />
            </label>
            <label className="field" htmlFor={`${idPrefix}-real`}>
              <span>Total con tax (US$)</span>
              <input
                id={`${idPrefix}-real`}
                className="input"
                name="realTotal"
                inputMode="decimal"
                placeholder="El de la foto"
                defaultValue={ticket ? usdCentsToInput(ticket.real_total_usd_cents) : ""}
                autoComplete="off"
              />
            </label>
          </div>
          <p className="admin-hint">
            Los artículos se capturan sin tax; el tax del ticket se suma una sola vez aquí. El total con tax lo llenas al
            cuadrar, copiándolo de la foto del ticket.
          </p>
          <PhotoField
            idPrefix={idPrefix}
            label="Foto del ticket"
            state={photo}
            existingUrl={ticket?.photoUrl ?? null}
            existingLabel={ticket?.hasPhoto ? "Foto guardada" : "Sin foto"}
            hasExisting={Boolean(ticket?.hasPhoto)}
            removeName="removePhoto"
            hint="Opcional. Se guarda privada; solo tú la ves."
          />
          <FormMessage state={{ error: state.error, success: null }} />
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending || photo.busy}>
              {pending ? "Guardando…" : ticket ? "Guardar ticket" : "Agregar ticket"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export type CaptureTotals = {
  ticketSubtotalUsdCents: number;
  ticketPieces: number;
  storeName: string;
  storeSubtotalUsdCents: number;
  storeTicketCount: number;
  purchaseSubtotalUsdCents: number;
  purchaseCapturedWithTaxUsdCents: number;
  purchasePieces: number;
  /** Purchase captured-with-tax converted at the purchase's rate, MXN centavos (null if the rate is unusable). */
  purchaseCapturedMxnCents: number | null;
};

type ItemFields = {
  name: string;
  variant: string;
  quantity: string;
  unitPrice: string;
};

function ItemFieldset({ idPrefix, initial, autoFocusName, nameRef }: { idPrefix: string; initial?: ItemFields; autoFocusName?: boolean; nameRef?: React.Ref<HTMLInputElement> }) {
  return (
    <>
      <label className="field" htmlFor={`${idPrefix}-name`}>
        <span>Producto *</span>
        <input
          ref={nameRef}
          id={`${idPrefix}-name`}
          className="input"
          name="name"
          defaultValue={initial?.name ?? ""}
          placeholder="Ej. Lip Glow Oil"
          autoComplete="off"
          enterKeyHint="next"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocusName}
          required
        />
      </label>
      <label className="field" htmlFor={`${idPrefix}-variant`}>
        <span>Variante</span>
        <input
          id={`${idPrefix}-variant`}
          className="input"
          name="variant"
          defaultValue={initial?.variant ?? ""}
          placeholder="Tono, tamaño, aroma…"
          autoComplete="off"
          enterKeyHint="next"
        />
      </label>
      <div className="shopper-two-cols">
        <label className="field" htmlFor={`${idPrefix}-qty`}>
          <span>Cantidad *</span>
          <input
            id={`${idPrefix}-qty`}
            className="input"
            name="quantity"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            defaultValue={initial?.quantity ?? "1"}
            required
          />
        </label>
        <label className="field" htmlFor={`${idPrefix}-price`}>
          <span>Precio c/u US$ *</span>
          <input
            id={`${idPrefix}-price`}
            className="input"
            name="unitPrice"
            inputMode="decimal"
            placeholder="sin tax"
            defaultValue={initial?.unitPrice ?? ""}
            autoComplete="off"
            enterKeyHint="done"
            required
          />
        </label>
      </div>
    </>
  );
}

/**
 * Inline "add item" form of one ticket, built for the phone: big fields, the
 * camera one tap away, and after saving it stays open and empty with the
 * cursor in "Producto" for the next item of the same ticket — no page reload.
 * The bar under it keeps the running totals (ticket / store / whole purchase).
 */
export function ItemCapture({
  purchaseId,
  ticketId,
  totals,
  defaultOpen,
}: {
  purchaseId: string;
  ticketId: string;
  totals: CaptureTotals;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const photo = usePhoto();
  const idPrefix = `capture-${ticketId}`;
  const { state, pending, onSubmit } = useActionForm<PurchaseActionState>(saveItemAction, {
    prepare: (formData) => {
      photo.attach(formData);
      setLastSaved(null);
    },
    onSuccess: (_next, form) => {
      const data = new FormData(form);
      setLastSaved(`${String(data.get("quantity") ?? "1")} × ${String(data.get("name") ?? "")}`);
      form.reset();
      photo.clear();
      nameRef.current?.focus();
    },
  });

  if (!open) {
    return (
      <div className="shopper-capture-closed">
        <Button type="button" size="small" onClick={() => setOpen(true)}>
          ＋ Agregar artículo
        </Button>
      </div>
    );
  }

  return (
    <div className="shopper-capture">
      <form onSubmit={onSubmit} className="shopper-capture-form">
        <input type="hidden" name="purchaseId" value={purchaseId} />
        <input type="hidden" name="ticketId" value={ticketId} />
        <ItemFieldset idPrefix={idPrefix} nameRef={nameRef} />
        <PhotoField idPrefix={idPrefix} label="Foto del producto" state={photo} hint="Opcional. Se reduce antes de subir." />
        <FormMessage state={{ error: state.error, success: null }} />
        {lastSaved && !state.error ? (
          <p className="form-message form-success" role="status">
            Agregado: {lastSaved}. Sigue con el siguiente.
          </p>
        ) : null}
        <div className="shopper-capture-actions">
          <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
          <Button type="submit" size="small" disabled={pending || photo.busy}>
            {pending ? "Guardando…" : photo.busy ? "Preparando foto…" : "Guardar artículo"}
          </Button>
        </div>
      </form>
      <div className="shopper-capture-bar" aria-live="polite">
        <div>
          <small>Este ticket</small>
          <strong>{formatUsd(totals.ticketSubtotalUsdCents)}</strong>
          <small>{totals.ticketPieces} pza(s)</small>
        </div>
        <div>
          <small>{totals.storeName}{totals.storeTicketCount > 1 ? ` (${totals.storeTicketCount})` : ""}</small>
          <strong>{formatUsd(totals.storeSubtotalUsdCents)}</strong>
          <small>sin tax</small>
        </div>
        <div>
          <small>Compra · {totals.purchasePieces} pza(s)</small>
          <strong>{formatUsd(totals.purchaseCapturedWithTaxUsdCents)}</strong>
          <small>con tax{totals.purchaseCapturedMxnCents !== null ? ` ≈ ${formatMoney(totals.purchaseCapturedMxnCents)}` : ""}</small>
        </div>
      </div>
    </div>
  );
}

export function ItemEditDialog({
  purchaseId,
  ticketId,
  item,
  icon,
}: {
  purchaseId: string;
  ticketId: string;
  item: {
    id: string;
    name: string;
    variant_label: string | null;
    quantity: number;
    unit_price_usd_cents: number;
    photoUrl: string | null;
  };
  icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const photo = usePhoto();
  const idPrefix = `item-${item.id}`;
  const { state, pending, onSubmit, reset } = useActionForm<PurchaseActionState>(saveItemAction, {
    prepare: photo.attach,
    onSuccess: () => {
      photo.clear();
      setOpen(false);
    },
  });
  const close = () => {
    photo.clear();
    reset();
    setOpen(false);
  };
  return (
    <>
      <button type="button" className="admin-icon-btn" aria-label={`Editar ${item.name}`} title="Editar" onClick={() => setOpen(true)}>
        {icon}
      </button>
      <Dialog open={open} title="Editar artículo" onClose={close}>
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            <input type="hidden" name="purchaseId" value={purchaseId} />
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="itemId" value={item.id} />
            <ItemFieldset
              idPrefix={idPrefix}
              initial={{
                name: item.name,
                variant: item.variant_label ?? "",
                quantity: String(item.quantity),
                unitPrice: usdCentsToInput(item.unit_price_usd_cents),
              }}
            />
            <PhotoField
              idPrefix={idPrefix}
              label="Foto del producto"
              state={photo}
              existingUrl={item.photoUrl}
              existingLabel={item.photoUrl ? "Foto guardada" : "Sin foto"}
              hasExisting={Boolean(item.photoUrl)}
              removeName="removePhoto"
            />
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" size="small" disabled={pending || photo.busy}>
                {pending ? "Guardando…" : "Guardar artículo"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
