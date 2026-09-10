"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input, Select } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { registerInventoryMovementAction } from "./actions";

export function InventoryMovementDialog({
  variantId,
  productName,
  variantName,
  unitLabel,
}: {
  variantId: string;
  productName: string;
  variantName: string;
  unitLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [movementType, setMovementType] = useState<"RECEIPT" | "MANUAL_ADJUSTMENT">("RECEIPT");
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await registerInventoryMovementAction(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant="secondary" size="small" onClick={() => setOpen(true)}>
        Ajustar stock
      </Button>
      <Dialog open={open} title={`Movimiento de inventario · ${productName}`} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          <input type="hidden" name="variantId" value={variantId} />
          <p className="admin-hint">
            {variantName}
            {unitLabel ? ` · se mide en ${unitLabel}` : ""}
          </p>
          <Select
            id="movement-type"
            name="movementType"
            label="Tipo de movimiento"
            value={movementType}
            onChange={(event) => setMovementType(event.target.value as "RECEIPT" | "MANUAL_ADJUSTMENT")}
          >
            <option value="RECEIPT">Entrada de mercancía (siempre suma)</option>
            <option value="MANUAL_ADJUSTMENT">Ajuste manual (merma, conteo físico, etc.)</option>
          </Select>
          <Input
            id="movement-quantity"
            name="quantity"
            label={movementType === "RECEIPT" ? "Cantidad que entra *" : "Ajuste (usa negativo para restar) *"}
            type="number"
            step={unitLabel ? "0.001" : "1"}
            min={movementType === "RECEIPT" ? "0.001" : undefined}
            required
          />
          <Input
            id="movement-reason"
            name="reason"
            label="Motivo *"
            placeholder={movementType === "RECEIPT" ? "Ej. Compra a proveedor, folio 123" : "Ej. Conteo físico, 2 piezas dañadas"}
            required
          />
          {state.error && (
            <p className="form-message form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="admin-form-actions">
            <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Guardando…" : "Registrar movimiento"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
