"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input, Textarea } from "../../../components/ui/Fields";
import { PURCHASE_COMMISSION_OPTIONS } from "../../../lib/supabase/purchase-math";
import { createPurchaseAction, createShopperAction, updatePurchaseAction, type PurchaseActionState } from "./actions";
import { FormMessage, useActionForm } from "./form-kit";

export type ShopperOption = { id: string; label: string };

export type PurchaseHeaderValues = {
  purchaseId?: string;
  supplierId: string;
  purchaseDate: string;
  exchangeRate: string;
  commission: string;
  notes: string;
};

/**
 * "Crear shopper": a quick supplier (same validation as Proveedores), selected
 * on the spot. Rendered next to — never inside — the purchase form, since a
 * form cannot contain another form.
 */
function ShopperQuickDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (option: ShopperOption) => void }) {
  const { state, pending, onSubmit } = useActionForm<PurchaseActionState>(createShopperAction, {
    onSuccess: (next, form) => {
      if (next.id) onCreated({ id: next.id, label: next.label ?? "Shopper nuevo" });
      form.reset();
      onClose();
    },
  });
  return (
    <Dialog open={open} title="Nuevo shopper" onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        <p className="admin-hint">Se guarda también en Proveedores (un shopper es un proveedor), así no lo capturas dos veces.</p>
        <Input id="shopper-name" name="name" label="Nombre *" required autoComplete="off" />
        <Input id="shopper-company" name="company" label="Empresa o ciudad" autoComplete="off" />
        <Input id="shopper-phone" name="phone" label="Teléfono / WhatsApp" type="tel" autoComplete="off" />
        <FormMessage state={{ error: state.error, success: null }} />
        <div className="admin-form-actions">
          <Button type="button" variant="secondary" size="small" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="small" disabled={pending}>
            {pending ? "Creando…" : "Crear shopper"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function PurchaseHeaderForm({
  shoppers,
  initial,
  today,
  lastRate,
  onSaved,
  onCancel,
}: {
  shoppers: ShopperOption[];
  initial: PurchaseHeaderValues;
  today: string;
  lastRate?: number | null;
  /** Edit mode: called after a successful save (e.g. to close the dialog). */
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(initial.purchaseId);
  const [options, setOptions] = useState(shoppers);
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [commission, setCommission] = useState(initial.commission);
  const [creatingShopper, setCreatingShopper] = useState(false);
  const { state, pending, onSubmit } = useActionForm<PurchaseActionState>(editing ? updatePurchaseAction : createPurchaseAction, {
    onSuccess: (next) => {
      if (editing) onSaved?.();
      else if (next.id) router.push(`/admin/compras/${next.id}`);
    },
  });

  const allOptions = options.some((option) => option.id === supplierId) || !supplierId
    ? options
    : [...options, { id: supplierId, label: "Shopper archivado" }];

  return (
    <>
    <form onSubmit={onSubmit} className="admin-form-grid shopper-header-form">
      {initial.purchaseId ? <input type="hidden" name="purchaseId" value={initial.purchaseId} /> : null}
      <div className="field field-wide">
        <label htmlFor="purchase-shopper">Shopper *</label>
        <select
          id="purchase-shopper"
          className="input select"
          name="supplierId"
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
          required
        >
          <option value="">Selecciona a quién le encargas la compra…</option>
          {allOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" className="shopper-link-button" onClick={() => setCreatingShopper(true)}>
          ＋ Crear shopper
        </button>
      </div>
      <Input
        id="purchase-date"
        name="purchaseDate"
        label="Fecha de la compra *"
        type="date"
        max={today}
        defaultValue={initial.purchaseDate}
        required
      />
      <div className="field">
        <label htmlFor="purchase-rate">Tipo de cambio USD→MXN *</label>
        <input
          id="purchase-rate"
          className="input"
          name="exchangeRate"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 18.25"
          defaultValue={initial.exchangeRate}
          required
        />
        <small className="admin-field-note">
          El de esta compra, hasta 4 decimales.{lastRate && !editing ? ` La compra anterior usó ${lastRate}.` : ""}
        </small>
      </div>
      <fieldset className="field field-wide shopper-fieldset">
        <legend>Comisión del shopper *</legend>
        <div className="admin-chip-row">
          {PURCHASE_COMMISSION_OPTIONS.map((option) => (
            <label key={option} className={`admin-chip${commission === String(option) ? " active" : ""}`} htmlFor={`purchase-commission-${option}`}>
              <input
                id={`purchase-commission-${option}`}
                className="sr-only"
                type="radio"
                name="commission"
                value={option}
                checked={commission === String(option)}
                onChange={() => setCommission(String(option))}
              />
              {option} %
            </label>
          ))}
        </div>
        <small className="admin-field-note">Se cobra sobre el total de los tickets ya con tax.</small>
      </fieldset>
      <div className="field-wide">
        <Textarea id="purchase-notes" name="notes" label="Notas" rows={2} maxLength={1000} defaultValue={initial.notes} placeholder="Opcional: viaje, ciudad, encargos…" />
      </div>
      <div className="field-wide">
        <FormMessage state={{ error: state.error, success: null }} />
      </div>
      <div className="admin-form-actions">
        {onCancel ? (
          <Button type="button" variant="secondary" size="small" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" size="small" disabled={pending}>
          {pending ? "Guardando…" : editing ? "Guardar cambios" : "Abrir compra"}
        </Button>
      </div>
    </form>
    <ShopperQuickDialog
      open={creatingShopper}
      onClose={() => setCreatingShopper(false)}
      onCreated={(option) => {
        setOptions((current) => [...current.filter((item) => item.id !== option.id), option]);
        setSupplierId(option.id);
      }}
    />
    </>
  );
}

export function EditPurchaseDialog(props: { shoppers: ShopperOption[]; initial: PurchaseHeaderValues; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>
        Editar datos
      </Button>
      <Dialog open={open} title="Datos de la compra" onClose={() => setOpen(false)} className="dialog-wide">
        {open ? <PurchaseHeaderForm {...props} onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}
