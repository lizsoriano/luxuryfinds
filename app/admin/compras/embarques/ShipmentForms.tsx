"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Dialog } from "../../../../components/ui/Dialog";
import { Textarea } from "../../../../components/ui/Fields";
import { formatMoney, initialsOf, LOGISTICS_STATUS_LABELS } from "../../../../lib/format";
import { parseShippingCostToCents } from "../../../../lib/supabase/purchase-math";
import { FormMessage, PhotoField, useActionForm, usePhoto } from "../form-kit";
import {
  cancelShipmentAction,
  confirmDepartureAction,
  createShipmentAction,
  receiveAllGoodAction,
  receiveLineAction,
  removeShipmentLineAction,
  setShipmentPaidAction,
  updateShipmentAction,
} from "./actions";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Big −/+ stepper (44 px targets on the phone) over a whole-number input. */
function Stepper({
  id,
  label,
  value,
  onChange,
  max,
  tone,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  max: number;
  tone?: "good" | "bad";
}) {
  return (
    <div className={`ship-stepper${tone ? ` ship-stepper-${tone}` : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="ship-stepper-row">
        <button type="button" aria-label={`${label}: una menos`} onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={String(value)}
          onChange={(event) => {
            const digits = event.target.value.replace(/[^\d]/g, "");
            onChange(Math.min(max, digits ? Number(digits) : 0));
          }}
          autoComplete="off"
        />
        <button type="button" aria-label={`${label}: una más`} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
          +
        </button>
      </div>
    </div>
  );
}

function HeaderFields({
  idPrefix,
  carriers,
  initial,
  cost,
  onCost,
  costLocked,
}: {
  idPrefix: string;
  carriers: string[];
  initial?: { carrier: string; trackingNumber: string; estimatedArrival: string; notes: string };
  cost: string;
  onCost: (value: string) => void;
  costLocked?: boolean;
}) {
  return (
    <div className="ship-header-fields">
      <label className="field" htmlFor={`${idPrefix}-carrier`}>
        <span>Paquetería *</span>
        <input
          id={`${idPrefix}-carrier`}
          className="input"
          name="carrier"
          list={`${idPrefix}-carriers`}
          defaultValue={initial?.carrier ?? ""}
          placeholder="Estafeta, DHL, nombre del embarque…"
          maxLength={80}
          autoComplete="off"
          required
        />
        <datalist id={`${idPrefix}-carriers`}>
          {carriers.map((carrier) => (
            <option key={carrier} value={carrier} />
          ))}
        </datalist>
      </label>
      <label className="field" htmlFor={`${idPrefix}-tracking`}>
        <span>Guía</span>
        <input id={`${idPrefix}-tracking`} className="input" name="trackingNumber" defaultValue={initial?.trackingNumber ?? ""} maxLength={120} autoComplete="off" />
      </label>
      <label className="field" htmlFor={`${idPrefix}-cost`}>
        <span>Costo de envío total (MXN)</span>
        <input
          id={`${idPrefix}-cost`}
          className="input"
          name="shippingCost"
          inputMode="decimal"
          placeholder="0.00"
          value={cost}
          onChange={(event) => onCost(event.target.value)}
          readOnly={costLocked}
          autoComplete="off"
        />
        {costLocked ? <small className="admin-field-note">Ya no cambia: el embarque empezó a recibirse.</small> : null}
      </label>
      <label className="field" htmlFor={`${idPrefix}-eta`}>
        <span>Llegada estimada</span>
        <input id={`${idPrefix}-eta`} className="input" type="date" name="estimatedArrival" defaultValue={initial?.estimatedArrival ?? ""} />
      </label>
      <label className="field ship-header-notes" htmlFor={`${idPrefix}-notes`}>
        <span>Notas</span>
        <textarea id={`${idPrefix}-notes`} className="input textarea" name="notes" rows={2} maxLength={1000} defaultValue={initial?.notes ?? ""} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create a shipment / add lines to a draft
// ---------------------------------------------------------------------------

export type BuilderAssignment = {
  assignmentId: string;
  clientName: string;
  quantity: number;
  ticketNumber: string | null;
  ticketLogisticsStatus: string | null;
  shippable: boolean;
};

export type BuilderItem = {
  id: string;
  name: string;
  variantLabel: string | null;
  photoUrl: string | null;
  storeName: string;
  purchaseNumber: string;
  supplierName: string;
  purchased: number;
  freeUnshipped: number;
  freeShipped: number;
  assignedShipped: number;
  assignments: BuilderAssignment[];
};

/**
 * Pick what travels: whole assignments (each one with its ticket) and/or a
 * number of free units per purchased line, from any purchase, store or shopper.
 * The shipping cost is previewed by pieces with the same rule the database uses.
 */
export function ShipmentBuilder({
  items,
  carriers,
  draft,
}: {
  items: BuilderItem[];
  carriers: string[];
  /** When adding to an existing draft. */
  draft?: { id: string; shipmentNumber: string; shippingCostCents: number; existingPieces: number } | null;
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Set<string>>(new Set());
  const [free, setFree] = useState<Record<string, number>>({});
  const [cost, setCost] = useState("");

  const selection = useMemo(() => {
    const lines: Array<{ assignmentId: string } | { purchaseItemId: string; quantity: number }> = [];
    const pieces: number[] = [];
    for (const item of items) {
      for (const assignment of item.assignments) {
        if (assignments.has(assignment.assignmentId)) {
          lines.push({ assignmentId: assignment.assignmentId });
          pieces.push(assignment.quantity);
        }
      }
      const units = free[item.id] ?? 0;
      if (units > 0) {
        lines.push({ purchaseItemId: item.id, quantity: units });
        pieces.push(units);
      }
    }
    return { lines, pieces, total: pieces.reduce((sum, value) => sum + value, 0) };
  }, [items, assignments, free]);

  const parsedCost = parseShippingCostToCents(cost);
  const costCents = draft ? draft.shippingCostCents : parsedCost.ok ? parsedCost.value : null;
  const allPieces = selection.total + (draft?.existingPieces ?? 0);
  const perPiece = costCents !== null && allPieces > 0 ? Math.round(costCents / allPieces) : null;

  const { state, pending, onSubmit } = useActionForm(createShipmentAction, {
    prepare: (formData) => formData.set("lines", JSON.stringify(selection.lines)),
    onSuccess: (next) => {
      if (next.id) router.push(`/admin/compras/embarques/${next.id}`);
    },
  });

  const toggle = (assignmentId: string) =>
    setAssignments((current) => {
      const next = new Set(current);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  const selectAll = (item: BuilderItem) => {
    setAssignments((current) => {
      const next = new Set(current);
      for (const assignment of item.assignments) if (assignment.shippable) next.add(assignment.assignmentId);
      return next;
    });
    setFree((current) => ({ ...current, [item.id]: item.freeUnshipped }));
  };

  return (
    <form onSubmit={onSubmit} className="ship-builder">
      {draft ? (
        <input type="hidden" name="shipmentId" value={draft.id} />
      ) : (
        <section className="card admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">DATOS DEL EMBARQUE</p>
              <h2>Paquetería y costo</h2>
            </div>
          </div>
          <HeaderFields idPrefix="new-shipment" carriers={carriers} cost={cost} onCost={setCost} />
          {!parsedCost.ok ? <small className="shopper-field-error">{parsedCost.error}</small> : null}
        </section>
      )}

      <section className="card admin-panel ship-pick-panel">
        <div className="section-heading">
          <div>
            <p className="micro-label">QUÉ VIAJA EN ESTE EMBARQUE</p>
            <h2>Elige asignaciones y piezas libres</h2>
          </div>
        </div>
        <p className="admin-hint">
          Una asignación viaja completa con su ticket (nunca se parte). Las piezas libres son las que todavía no asignas a
          ninguna clienta: al llegar entran a tu inventario. Si usas el buscador o los filtros de arriba, elige después (la
          selección se reinicia).
        </p>
        <ul className="assign-list ship-pick-list">
          {items.map((item) => {
            const units = free[item.id] ?? 0;
            return (
              <li key={item.id} className="assign-item">
                <div className="assign-item-head">
                  {item.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="shopper-item-thumb" src={item.photoUrl} alt="" />
                  ) : (
                    <span className="shopper-item-thumb admin-thumb-fallback" aria-hidden>
                      {initialsOf(item.name)}
                    </span>
                  )}
                  <div className="shopper-item-main">
                    <strong>{item.name}</strong>
                    <small>
                      {item.variantLabel ? `${item.variantLabel} · ` : ""}
                      {item.storeName}
                    </small>
                    <small>
                      {item.purchaseNumber} · {item.supplierName} · {item.purchased} comprada(s)
                      {item.freeShipped + item.assignedShipped ? ` · ${item.freeShipped + item.assignedShipped} ya en embarque` : ""}
                    </small>
                  </div>
                  <Button type="button" variant="secondary" size="small" onClick={() => selectAll(item)}>
                    Todo
                  </Button>
                </div>
                {item.assignments.length ? (
                  <ul className="ship-pick-rows">
                    {item.assignments.map((assignment) => (
                      <li key={assignment.assignmentId}>
                        <label
                          className={`ship-pick${assignment.shippable ? "" : " ship-pick-disabled"}`}
                          aria-label={`${assignment.clientName}: ${assignment.quantity} pieza(s), ticket ${assignment.ticketNumber ?? ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={assignments.has(assignment.assignmentId)}
                            disabled={!assignment.shippable}
                            onChange={() => toggle(assignment.assignmentId)}
                          />
                          <span>
                            <b>
                              <strong>{assignment.clientName}</strong> · {assignment.quantity} pza(s)
                            </b>
                            <small>
                              Ticket {assignment.ticketNumber ?? "—"} ·{" "}
                              {assignment.ticketLogisticsStatus
                                ? (LOGISTICS_STATUS_LABELS[assignment.ticketLogisticsStatus] ?? assignment.ticketLogisticsStatus)
                                : "—"}
                              {assignment.shippable ? "" : " · no se puede enviar en ese estado"}
                            </small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.freeUnshipped > 0 ? (
                  <div className="ship-free-row">
                    <span>
                      <strong>Piezas libres</strong>
                      <small>{item.freeUnshipped} sin asignar ni embarcar</small>
                    </span>
                    <Stepper
                      id={`free-${item.id}`}
                      label="Libres que van"
                      value={units}
                      max={item.freeUnshipped}
                      onChange={(value) => setFree((current) => ({ ...current, [item.id]: value }))}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="ship-builder-bar" aria-live="polite">
        <div>
          <small>Líneas</small>
          <strong>{selection.lines.length}</strong>
        </div>
        <div>
          <small>Piezas</small>
          <strong>{selection.total}</strong>
        </div>
        <div>
          <small>{draft ? `Envío ${draft.shipmentNumber}` : "Envío por pieza"}</small>
          <strong>{perPiece !== null ? `≈ ${formatMoney(perPiece)}` : "—"}</strong>
        </div>
        <Button type="submit" size="small" disabled={pending || !selection.lines.length || (!draft && !parsedCost.ok)}>
          {pending ? "Guardando…" : draft ? "Agregar al embarque" : "Crear embarque"}
        </Button>
      </div>
      <FormMessage state={{ error: state.error, success: null }} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Detail page actions
// ---------------------------------------------------------------------------

export function EditShipmentDialog({
  shipmentId,
  carriers,
  initial,
  costLocked,
}: {
  shipmentId: string;
  carriers: string[];
  initial: { carrier: string; trackingNumber: string; shippingCost: string; estimatedArrival: string; notes: string };
  costLocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState(initial.shippingCost);
  const { state, pending, onSubmit, reset } = useActionForm(updateShipmentAction, { onSuccess: () => setOpen(false) });
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="small"
        onClick={() => {
          reset();
          setCost(initial.shippingCost);
          setOpen(true);
        }}
      >
        Editar datos
      </Button>
      <Dialog open={open} title="Datos del embarque" onClose={() => setOpen(false)} className="dialog-wide dialog-assign">
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            <input type="hidden" name="shipmentId" value={shipmentId} />
            <HeaderFields idPrefix={`edit-${shipmentId}`} carriers={carriers} initial={initial} cost={cost} onCost={setCost} costLocked={costLocked} />
            <p className="admin-hint">Si cambias el costo de envío, se vuelve a repartir entre las líneas por piezas.</p>
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="small" disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

/** A confirmation dialog for one-field actions (departure, remove line, all good). */
function ConfirmDialog({
  triggerLabel,
  triggerVariant = "secondary",
  title,
  children,
  confirmLabel,
  confirmVariant = "primary",
  action,
  fields,
  iconTrigger,
}: {
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary" | "danger";
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "secondary" | "danger";
  action: typeof confirmDepartureAction;
  fields: Record<string, string>;
  iconTrigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, reset } = useActionForm(action, { onSuccess: () => setOpen(false) });
  const show = () => {
    reset();
    setOpen(true);
  };
  return (
    <>
      {iconTrigger ? (
        <button type="button" className="admin-icon-btn" aria-label={triggerLabel} title={triggerLabel} onClick={show}>
          {iconTrigger}
        </button>
      ) : (
        <Button type="button" variant={triggerVariant} size="small" onClick={show}>
          {triggerLabel}
        </Button>
      )}
      <Dialog open={open} title={title} onClose={() => setOpen(false)}>
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {children}
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Volver
              </Button>
              <Button type="submit" variant={confirmVariant} size="small" disabled={pending}>
                {pending ? "Procesando…" : confirmLabel}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

export function ConfirmDepartureDialog({ shipmentId, pieces, tickets }: { shipmentId: string; pieces: number; tickets: number }) {
  return (
    <ConfirmDialog
      triggerLabel="Confirmar salida"
      triggerVariant="primary"
      title="Confirmar salida del embarque"
      confirmLabel="Confirmar salida"
      action={confirmDepartureAction}
      fields={{ shipmentId }}
    >
      <p className="admin-hint">
        Sale con {pieces} pieza(s). {tickets ? `${tickets} ticket(s) de clientas pasan a "En camino" y se les avisa. ` : ""}
        Después ya no se agregan ni quitan artículos; el costo de envío se puede corregir hasta que empieces a recibir.
      </p>
    </ConfirmDialog>
  );
}

export function ReceiveAllGoodDialog({ shipmentId, pending }: { shipmentId: string; pending: number }) {
  return (
    <ConfirmDialog
      triggerLabel="Todo llegó bien"
      title="Recibir todo en buen estado"
      confirmLabel={`Recibir ${pending} pieza(s)`}
      action={receiveAllGoodAction}
      fields={{ shipmentId }}
    >
      <p className="admin-hint">
        Registra las {pending} pieza(s) pendientes como recibidas en buen estado, en una sola recepción. Si alguna llegó
        dañada o falta, mejor usa <strong>Recibir</strong> en esa línea.
      </p>
    </ConfirmDialog>
  );
}

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinejoin="round" />
  </svg>
);

export function RemoveLineButton({ lineId, label }: { lineId: string; label: string }) {
  return (
    <ConfirmDialog
      triggerLabel={`Quitar ${label}`}
      title="Quitar del embarque"
      confirmLabel="Quitar"
      confirmVariant="danger"
      action={removeShipmentLineAction}
      fields={{ lineId }}
      iconTrigger={<TrashIcon />}
    >
      <p className="admin-hint">{label} vuelve a quedar pendiente de envío. El costo de envío se reparte de nuevo.</p>
    </ConfirmDialog>
  );
}

export function CancelShipmentDialog({ shipmentId }: { shipmentId: string }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, reset } = useActionForm(cancelShipmentAction, { onSuccess: () => setOpen(false) });
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
        Cancelar embarque
      </Button>
      <Dialog open={open} title="Cancelar embarque" onClose={() => setOpen(false)}>
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            <input type="hidden" name="shipmentId" value={shipmentId} />
            <p className="admin-hint">
              Solo un embarque en preparación se cancela. Sus artículos vuelven a quedar pendientes de envío y puedes
              mandarlos en otro.
            </p>
            <Textarea id={`cancel-shipment-${shipmentId}`} name="reason" label="Motivo *" rows={2} maxLength={500} required />
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Volver
              </Button>
              <Button type="submit" variant="danger" size="small" disabled={pending}>
                {pending ? "Cancelando…" : "Cancelar embarque"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

export function PaidDialog({
  shipmentId,
  shipmentNumber,
  costCents,
  paid,
  paidOn,
  today,
}: {
  shipmentId: string;
  shipmentNumber: string;
  costCents: number;
  paid: boolean;
  paidOn: string | null;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, reset } = useActionForm(setShipmentPaidAction, { onSuccess: () => setOpen(false) });
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
        {paid ? "Pago del envío" : "Marcar pagado"}
      </Button>
      <Dialog open={open} title={`Pago del envío ${shipmentNumber}`} onClose={() => setOpen(false)}>
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form">
            <input type="hidden" name="shipmentId" value={shipmentId} />
            <input type="hidden" name="paid" value={paid ? "false" : "true"} />
            <p className="admin-hint">
              Costo de envío: <strong>{formatMoney(costCents)}</strong>.{" "}
              {paid ? `Marcado como pagado el ${paidOn ?? "—"}.` : "Registra cuándo le pagaste a la paquetería."}
            </p>
            {paid ? null : (
              <label className="field" htmlFor={`paid-on-${shipmentId}`}>
                <span>Fecha de pago *</span>
                <input id={`paid-on-${shipmentId}`} className="input" type="date" name="paidOn" defaultValue={today} max={today} required />
              </label>
            )}
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Volver
              </Button>
              <Button type="submit" variant={paid ? "secondary" : "primary"} size="small" disabled={pending}>
                {pending ? "Guardando…" : paid ? "Marcar como NO pagado" : "Marcar pagado"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

export type ReceivableLine = {
  id: string;
  name: string;
  variantLabel: string | null;
  kind: "ASSIGNMENT" | "FREE";
  expected: number;
  good: number;
  damaged: number;
  missing: number;
  pending: number;
  clientName: string | null;
  ticketNumber: string | null;
};

/**
 * Reception of one line, phone first: three big steppers (good / damaged /
 * missing, the rest stays pending), observations and one photo per submit
 * (compressed in the browser). Submitting only a note or a photo is allowed.
 */
export function ReceiveLineDialog({ shipmentId, line }: { shipmentId: string; line: ReceivableLine }) {
  const [open, setOpen] = useState(false);
  const [good, setGood] = useState(line.pending);
  const [damaged, setDamaged] = useState(0);
  const [missing, setMissing] = useState(0);
  const photo = usePhoto();
  const { state, pending, onSubmit, reset } = useActionForm(receiveLineAction, {
    prepare: (formData) => {
      photo.attach(formData);
      formData.set("good", String(good));
      formData.set("damaged", String(damaged));
      formData.set("missing", String(missing));
    },
    onSuccess: () => setOpen(false),
  });
  const captured = good + damaged + missing;
  const over = captured > line.pending;
  const left = line.pending - captured;

  return (
    <>
      <Button
        type="button"
        size="small"
        onClick={() => {
          reset();
          photo.clear();
          setGood(line.pending);
          setDamaged(0);
          setMissing(0);
          setOpen(true);
        }}
      >
        Recibir
      </Button>
      <Dialog open={open} title="Recibir en La Paz" onClose={() => setOpen(false)} className="dialog-wide dialog-assign">
        {open ? (
          <form onSubmit={onSubmit} className="dialog-form ship-receive-form">
            <input type="hidden" name="shipmentId" value={shipmentId} />
            <input type="hidden" name="lineId" value={line.id} />
            <div className="assign-dialog-item">
              <strong>{line.name}</strong>
              <small>
                {line.variantLabel ? `${line.variantLabel} · ` : ""}
                {line.kind === "ASSIGNMENT" ? `Ticket ${line.ticketNumber ?? "—"} · ${line.clientName ?? ""}` : "Piezas libres"}
              </small>
              <small>
                Esperadas {line.expected} · ya capturadas {line.expected - line.pending} · <b>pendientes {line.pending}</b>
              </small>
            </div>
            <div className="ship-steppers">
              <Stepper id={`good-${line.id}`} label="En buen estado" value={good} max={line.pending - damaged - missing} onChange={setGood} tone="good" />
              <Stepper
                id={`damaged-${line.id}`}
                label="Dañadas"
                value={damaged}
                max={line.pending - missing}
                onChange={(value) => {
                  setDamaged(value);
                  // A damaged unit comes out of the "good" count first (good starts at all pending).
                  setGood((current) => Math.max(0, Math.min(current, line.pending - value - missing)));
                }}
                tone="bad"
              />
              <Stepper
                id={`missing-${line.id}`}
                label="Faltantes"
                value={missing}
                max={line.pending - damaged}
                onChange={(value) => {
                  setMissing(value);
                  setGood((current) => Math.max(0, Math.min(current, line.pending - damaged - value)));
                }}
                tone="bad"
              />
            </div>
            <p className={over ? "shopper-field-error" : "admin-hint"} aria-live="polite">
              {over
                ? `Son ${captured} y solo quedan ${line.pending} pendiente(s).`
                : left > 0
                  ? `${left} pieza(s) quedan pendientes dentro del embarque (puedes recibirlas después).`
                  : "Con esto la línea queda completa."}
            </p>
            <Textarea id={`notes-${line.id}`} name="notes" label="Observaciones" rows={2} maxLength={1000} placeholder="Ej. caja golpeada, tapa rota…" />
            <PhotoField idPrefix={`receipt-${line.id}`} label="Foto (opcional)" state={photo} hint="Una foto por envío; para otra, registra de nuevo solo con la foto." />
            <p className="admin-hint">
              {line.kind === "ASSIGNMENT"
                ? "Si todas llegan en buen estado, el ticket queda Listo para entrega (ya se puede agendar). Si alguna llega dañada o falta, queda en Recibido en La Paz con una incidencia para que decidas."
                : "Las piezas en buen estado entran a Productos entrega inmediata (oculto y a $0 hasta que le pongas precio). Las dañadas y faltantes no entran al inventario."}
            </p>
            <FormMessage state={{ error: state.error, success: null }} />
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" size="small" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="small" disabled={pending || photo.busy || over}>
                {pending ? "Guardando…" : "Registrar recepción"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

export function LineKindBadge({ kind }: { kind: "ASSIGNMENT" | "FREE" }) {
  return <Badge tone={kind === "ASSIGNMENT" ? "rose" : "neutral"}>{kind === "ASSIGNMENT" ? "Asignación" : "Piezas libres"}</Badge>;
}
