"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input, Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { createSupplierAction, updateSupplierAction } from "./actions";

export type SupplierFormValues = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

export function SupplierDialog({
  supplier,
  triggerLabel,
  triggerVariant = "primary",
}: {
  supplier?: SupplierFormValues;
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await (supplier ? updateSupplierAction : createSupplierAction)(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    emptyActionState,
  );

  return (
    <>
      <Button type="button" variant={triggerVariant} size="small" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} title={supplier ? "Editar proveedor" : "Nuevo proveedor"} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}
          <Input id="supplier-name" name="name" label="Nombre de contacto *" defaultValue={supplier?.name ?? ""} required />
          <Input id="supplier-company" name="company" label="Empresa" defaultValue={supplier?.company ?? ""} />
          <Input id="supplier-phone" name="phone" label="Teléfono" defaultValue={supplier?.phone ?? ""} />
          <Input id="supplier-email" name="email" label="Correo" type="email" defaultValue={supplier?.email ?? ""} />
          <Input id="supplier-address" name="address" label="Dirección" defaultValue={supplier?.address ?? ""} />
          <Textarea id="supplier-notes" name="notes" label="Notas" rows={3} defaultValue={supplier?.notes ?? ""} />
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
              {pending ? "Guardando…" : supplier ? "Guardar cambios" : "Crear proveedor"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
