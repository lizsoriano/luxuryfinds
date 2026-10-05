"use client";

import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Textarea } from "../../../components/ui/Fields";
import { formatMoney } from "../../../lib/format";
import { parseAssignQuantity, parseSalePriceToCents, previewAssignment } from "../../../lib/supabase/purchase-math";
import { assignPurchaseItemAction, cancelAssignmentAction } from "./actions";
import { FormMessage, useActionForm } from "./form-kit";

export type AssignableItem = {
  id: string;
  purchaseId: string;
  name: string;
  variantLabel: string | null;
  storeName: string;
  purchased: number;
  assigned: number;
  available: number;
  assignedCostMxnCents: number;
  lineCostMxnCents: number;
};

export type ClientOption = { id: string; label: string; phone: string };

const PERCENT = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * "Asignar": which client, how many units (up to what is still available) and
 * the sale price per unit she decides. The cost of those units and the margin
 * are shown live with the same formula the database freezes; nothing is
 * suggested or filled in for her.
 */
export function AssignDialog({ item, clients }: { item: AssignableItem; clients: ClientOption[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const { state, pending, onSubmit, reset } = useActionForm(assignPurchaseItemAction, { onSuccess: () => setOpen(false) });

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) return clients;
    return clients.filter((client) => normalize(`${client.label} ${client.phone}`).includes(term) || client.id === clientId);
  }, [clients, search, clientId]);

  const parsedQuantity = parseAssignQuantity(quantity, item.available);
  const parsedPrice = parseSalePriceToCents(price);
  const costInput = {
    lineCostMxnCents: item.lineCostMxnCents,
    lineQuantity: item.purchased,
    activeAssignedQuantity: item.assigned,
    activeAssignedCostMxnCents: item.assignedCostMxnCents,
  };
  let preview: ReturnType<typeof previewAssignment> | null = null;
  let costOnly: number | null = null;
  if (parsedQuantity.ok) {
    try {
      if (parsedPrice.ok) preview = previewAssignment({ ...costInput, quantity: parsedQuantity.value, unitPriceCents: parsedPrice.value });
      else costOnly = previewAssignment({ ...costInput, quantity: parsedQuantity.value, unitPriceCents: 0 }).costMxnCents;
    } catch {
      preview = null;
    }
  }
  const pieces = parsedQuantity.ok ? parsedQuantity.value : null;
  const cost = preview?.costMxnCents ?? costOnly;
  const losing = preview !== null && preview.profitCents < 0;

  const step = (delta: number) => {
    const current = parsedQuantity.ok ? parsedQuantity.value : 0;
    setQuantity(String(Math.min(item.available, Math.max(1, current + delta))));
  };

  return (
    <>
      <Button
        type="button"
        size="small"
        onClick={() => {
          reset();
          setSearch("");
          setClientId("");
          setQuantity("1");
          setPrice("");
          setOpen(true);
        }}
      >
        Asignar
      </Button>
      <Dialog open={open} title="Asignar a una clienta" onClose={() => setOpen(false)} className="dialog-wide dialog-assign">
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form assign-form">
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="purchaseId" value={item.purchaseId} />
            <div className="assign-dialog-item">
              <strong>{item.name}</strong>
              <small>
                {item.variantLabel ? `${item.variantLabel} · ` : ""}
                {item.storeName} · Disponibles {item.available} de {item.purchased}
              </small>
            </div>

            <div className="assign-client-picker">
              <label className="field" htmlFor={`assign-search-${item.id}`}>
                <span>Buscar clienta</span>
                <input
                  id={`assign-search-${item.id}`}
                  className="input"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nombre o teléfono…"
                  autoComplete="off"
                />
              </label>
              <label className="field" htmlFor={`assign-client-${item.id}`}>
                <span>Clienta * {search.trim() ? <small className="admin-hint">({filtered.length} encontradas)</small> : null}</span>
                <select
                  id={`assign-client-${item.id}`}
                  className="input select"
                  name="clientId"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  required
                >
                  <option value="">{clients.length ? "Selecciona una clienta…" : "No hay clientas activas"}</option>
                  {filtered.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.label} · {client.phone}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="shopper-two-cols">
              <div className="field">
                <label htmlFor={`assign-qty-${item.id}`}>
                  <span>Piezas * (máx. {item.available})</span>
                </label>
                <div className="pos-qty assign-qty">
                  <button type="button" aria-label="Una pieza menos" onClick={() => step(-1)} disabled={!parsedQuantity.ok || parsedQuantity.value <= 1}>
                    −
                  </button>
                  <input
                    id={`assign-qty-${item.id}`}
                    name="quantity"
                    inputMode="numeric"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value.replace(/[^\d]/g, ""))}
                    autoComplete="off"
                    required
                  />
                  <button
                    type="button"
                    aria-label="Una pieza más"
                    onClick={() => step(1)}
                    disabled={parsedQuantity.ok && parsedQuantity.value >= item.available}
                  >
                    +
                  </button>
                </div>
              </div>
              <label className="field" htmlFor={`assign-price-${item.id}`}>
                <span>Precio de venta por pieza (MXN) *</span>
                <input
                  id={`assign-price-${item.id}`}
                  className="input"
                  name="unitPrice"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
            </div>
            {!parsedQuantity.ok && quantity !== "" ? <small className="shopper-field-error">{parsedQuantity.error}</small> : null}
            {!parsedPrice.ok && price.trim() !== "" ? <small className="shopper-field-error">{parsedPrice.error}</small> : null}

            <dl className="assign-preview" aria-live="polite">
              <div>
                <dt>Costo por pieza</dt>
                <dd>{cost !== null && pieces ? formatMoney(Math.round(cost / pieces)) : "—"}</dd>
              </div>
              <div>
                <dt>Utilidad por pieza</dt>
                <dd className={losing ? "assign-negative" : undefined}>{preview ? formatMoney(Math.round(preview.unitProfitCents)) : "—"}</dd>
              </div>
              <div>
                <dt>Margen</dt>
                <dd className={losing ? "assign-negative" : undefined}>
                  {preview ? (preview.marginPercent === null ? "—" : `${PERCENT.format(preview.marginPercent)} %`) : "—"}
                </dd>
              </div>
              <div>
                <dt>Venta{pieces ? ` (${pieces} pza)` : ""}</dt>
                <dd>{preview ? formatMoney(preview.saleTotalCents) : "—"}</dd>
              </div>
              <div>
                <dt>Costo{pieces ? ` (${pieces} pza)` : ""}</dt>
                <dd>{cost !== null ? formatMoney(cost) : "—"}</dd>
              </div>
              <div className="assign-preview-strong">
                <dt>Utilidad</dt>
                <dd className={losing ? "assign-negative" : undefined}>{preview ? formatMoney(preview.profitCents) : "—"}</dd>
              </div>
            </dl>
            {losing ? <p className="admin-hint shopper-warning">Ojo: con ese precio vendes por debajo de lo que te costó.</p> : null}
            <p className="admin-hint">
              Costo puesto en tienda (precio + tax + comisión, en pesos), sin paquetería. Se genera un ticket de venta a nombre de la
              clienta, en estado <strong>Ordenado</strong> y pago completo; lo paga y se cobra como cualquier otro ticket.
            </p>
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="small" disabled={pending || !clientId || !parsedQuantity.ok || !parsedPrice.ok}>
                {pending ? "Asignando…" : "Asignar y generar ticket"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * Cancelling an assignment cancels its ticket (and the pedido) and frees the
 * units. Like voiding an abono, it asks for the reason; the database refuses it
 * once the ticket has shipped or the client has paid something.
 */
export function CancelAssignmentDialog({
  assignmentId,
  purchaseId,
  summary,
}: {
  assignmentId: string;
  purchaseId: string;
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, reset } = useActionForm(cancelAssignmentAction, { onSuccess: () => setOpen(false) });
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="small"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Cancelar asignación
      </Button>
      <Dialog open={open} title="Cancelar asignación" onClose={() => setOpen(false)}>
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            <input type="hidden" name="assignmentId" value={assignmentId} />
            <input type="hidden" name="purchaseId" value={purchaseId} />
            <p className="admin-hint">
              {summary}. Se cancela su ticket (y el pedido) y las piezas vuelven a quedar disponibles. Solo se puede mientras el
              ticket siga en <strong>Ordenado</strong> y la clienta no haya pagado nada; si ya pagó, resuélvelo antes desde Cobranza
              o Devoluciones.
            </p>
            <Textarea id={`cancel-assignment-${assignmentId}`} name="reason" label="Motivo *" rows={2} maxLength={500} required />
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Volver
              </Button>
              <Button type="submit" variant="danger" size="small" disabled={pending}>
                {pending ? "Cancelando…" : "Cancelar asignación"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
