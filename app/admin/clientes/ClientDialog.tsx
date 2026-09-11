"use client";

import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Input, Textarea } from "../../../components/ui/Fields";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { createClientAction, updateClientAction } from "./actions";

export type ClientFormValues = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  instagram: string | null;
  address: string | null;
  internal_notes: string | null;
  payment_plans_allowed: boolean;
};

export function ClientDialog({
  client,
  triggerLabel,
  triggerVariant = "primary",
}: {
  client?: ClientFormValues;
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await (client ? updateClientAction : createClientAction)(previous, formData);
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
      <Dialog open={open} title={client ? "Editar clienta" : "Nueva clienta"} onClose={() => setOpen(false)}>
        <form action={action} className="dialog-form">
          {client ? <input type="hidden" name="id" value={client.id} /> : null}
          <Input id="client-first" name="firstName" label="Nombre *" defaultValue={client?.first_name ?? ""} required />
          <Input id="client-last" name="lastName" label="Apellido *" defaultValue={client?.last_name ?? ""} required />
          <Input
            id="client-phone"
            name="phone"
            label="Celular *"
            defaultValue={client?.phone ?? ""}
            placeholder="+52..."
            required
          />
          <Input id="client-email" name="email" label="Correo" type="email" defaultValue={client?.email ?? ""} />
          <Input id="client-instagram" name="instagram" label="Instagram" defaultValue={client?.instagram ?? ""} />
          <Input id="client-address" name="address" label="Dirección" defaultValue={client?.address ?? ""} />
          <Textarea
            id="client-notes"
            name="notes"
            label="Notas internas"
            rows={3}
            defaultValue={client?.internal_notes ?? ""}
          />
          <label className="admin-switch" htmlFor="client-plans">
            <input
              id="client-plans"
              type="checkbox"
              name="paymentPlansAllowed"
              defaultChecked={client?.payment_plans_allowed ?? false}
            />
            <span>
              Puede comprar con plan de pagos
              <small>Habilita los planes semanales y el apartado para esta clienta.</small>
            </span>
          </label>
          {!client ? (
            <p className="admin-hint">
              Se crea también su cuenta de acceso. No necesita contraseña: en &quot;Iniciar sesión&quot; puede entrar
              solo con este celular, en la pestaña &quot;Solo mi celular&quot;.
            </p>
          ) : null}
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
              {pending ? "Guardando…" : client ? "Guardar cambios" : "Registrar clienta"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
