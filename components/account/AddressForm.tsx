"use client";

import { useActionState } from "react";
import { updateAddressAction } from "../../app/cuenta/account-actions";
import { emptyActionState } from "../../lib/actions";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Fields";

export function AddressForm({ address }: { address: string | null }) {
  const [state, action, pending] = useActionState(updateAddressAction, emptyActionState);
  return (
    <form action={action} className="dialog-form">
      <Textarea id="client-address" name="address" label="Dirección para entregas por DiDi" rows={3} maxLength={300} defaultValue={address ?? ""} placeholder="Calle, número, colonia y referencias" />
      {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
      {state.success && <p className="form-message form-success" role="status">{state.success}</p>}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Guardando…" : "Guardar dirección"}</Button>
    </form>
  );
}
