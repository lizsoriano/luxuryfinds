"use client";

import { useState } from "react";
import { formatMoney, parseMoneyToCents } from "../../../lib/format";
import { allocateCollection } from "../../../lib/supabase/delivery-math";
import type { ScheduledDelivery } from "../../../lib/supabase/staff-deliveries";
import { FormMessage, PhotoField, useActionForm, usePhoto } from "../../admin/compras/form-kit";
import { confirmDeliveryAction, type StaffActionState } from "../actions";

type Method = "CASH" | "TRANSFER" | "NONE";

/**
 * "Confirmar entrega" in four steps, on one screen (a phone at the door):
 *  1. review products and balance, and mark what is handed over;
 *  2. what was collected now: cash, transfer (reported, validated later by the
 *     owner) or nothing;
 *  3. who received: the clienta or another person (name + relationship);
 *  4. confirm — with an explicit check when a balance stays pending.
 * Nothing is saved until step 4; the server repeats every check atomically.
 */
export function DeliveryFlow({ delivery, bookingId }: { delivery: ScheduledDelivery; bookingId: string }) {
  const deliverable = delivery.items.filter((item) => item.deliverable);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(deliverable.map((item) => item.ticketId)));
  const initialBalance = deliverable.reduce((sum, item) => sum + item.balanceCents, 0);
  const [method, setMethod] = useState<Method>(() => (initialBalance > 0 ? "CASH" : "NONE"));
  const [amountText, setAmountText] = useState(() => (initialBalance > 0 ? (initialBalance / 100).toFixed(2) : ""));
  const [receivedBy, setReceivedBy] = useState<"CLIENT" | "OTHER">("CLIENT");
  const [acknowledged, setAcknowledged] = useState(false);
  const photo = usePhoto();
  const { state, pending, onSubmit } = useActionForm<StaffActionState>(confirmDeliveryAction, {
    prepare: (formData) => {
      if (method === "TRANSFER") photo.attach(formData);
      else formData.delete("photo");
    },
  });

  const chosen = delivery.items.filter((item) => selected.has(item.ticketId));
  const balance = chosen.reduce((sum, item) => sum + item.balanceCents, 0);
  const amount = method === "NONE" ? 0 : (parseMoneyToCents(amountText) ?? 0);
  const remaining = balance - amount;
  const reportedPending = chosen.reduce((sum, item) => sum + item.reportedPendingCents, 0);
  // Same split confirm_staff_delivery() applies (preview only; the server decides).
  const shares = allocateCollection(chosen, amount);

  const problems: string[] = [];
  if (!chosen.length) problems.push("Marca al menos un artículo entregado.");
  if (amount < 0) problems.push("El importe no puede ser negativo.");
  if (amount > balance) problems.push(`El cobro no puede ser mayor que el saldo de lo que entregas (${formatMoney(balance)}).`);
  if (method !== "NONE" && amount === 0 && balance > 0) problems.push("Escribe cuánto cobraste o elige “No cobré”.");

  const toggle = (ticketId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });

  return (
    <form className="staff-flow" onSubmit={onSubmit}>
      <input type="hidden" name="bookingId" value={bookingId} />

      <section className="staff-card staff-step">
        <h2>
          <span className="staff-step-number">1</span> Revisa productos y saldo
        </h2>
        <p className="staff-hint">Marca lo que entregas. Cada renglón es un ticket y se entrega completo.</p>
        <ul className="staff-check-list">
          {delivery.items.map((item) => (
            <li key={item.ticketId} className={item.deliverable ? "" : "is-disabled"}>
              <label htmlFor={`ticket-${item.ticketId}`}>
                <input
                  id={`ticket-${item.ticketId}`}
                  type="checkbox"
                  name="ticketId"
                  value={item.ticketId}
                  checked={selected.has(item.ticketId)}
                  disabled={!item.deliverable}
                  onChange={() => toggle(item.ticketId)}
                />
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="staff-thumb" src={item.imageUrl} alt="" />
                ) : (
                  <span className="staff-thumb staff-thumb-empty" aria-hidden>
                    LF
                  </span>
                )}
                <span className="staff-check-main">
                  <strong>
                    {item.quantity} × {item.productName}
                  </strong>
                  <small>
                    {item.variantName && item.variantName !== "Único" ? `${item.variantName} · ` : ""}
                    {item.ticketNumber}
                  </small>
                  <small>
                    Total {formatMoney(item.agreedTotalCents)} · pagado {formatMoney(item.paidCents)}
                    {item.reportedPendingCents ? ` · transferencia por validar ${formatMoney(item.reportedPendingCents)}` : ""}
                  </small>
                  {!item.deliverable ? <small className="staff-warning">Ya no está listo para entregarse.</small> : null}
                </span>
                <span className={item.balanceCents > 0 ? "staff-balance staff-balance-due" : "staff-balance staff-balance-paid"}>
                  {item.balanceCents > 0 ? formatMoney(item.balanceCents) : "Pagado"}
                </span>
              </label>
              <input type="hidden" name={`balance:${item.ticketId}`} value={item.balanceCents} />
            </li>
          ))}
        </ul>
        <div className="staff-total-row">
          <span>Saldo pendiente de lo que entregas</span>
          <strong>{formatMoney(balance)}</strong>
        </div>
        {reportedPending ? (
          <p className="staff-note">
            Ya hay {formatMoney(reportedPending)} en transferencias reportadas que la dueña aún no valida. No las cobres dos veces.
          </p>
        ) : null}
      </section>

      <section className="staff-card staff-step">
        <h2>
          <span className="staff-step-number">2</span> Cobro restante
        </h2>
        <div className="staff-segmented" role="radiogroup" aria-label="Cómo pagó">
          {(
            [
              ["CASH", "Efectivo"],
              ["TRANSFER", "Transferencia"],
              ["NONE", "No cobré"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={method === value ? "active" : ""} htmlFor={`method-${value}`}>
              <input
                id={`method-${value}`}
                type="radio"
                name="method"
                value={value === "NONE" ? "" : value}
                checked={method === value}
                onChange={() => setMethod(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {method !== "NONE" ? (
          <>
            <label className="field" htmlFor="delivery-amount">
              <span>Importe cobrado *</span>
              <input
                id="delivery-amount"
                className="input staff-amount"
                name="amount"
                inputMode="decimal"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                placeholder="$0.00"
              />
            </label>
            <label className="field" htmlFor="delivery-reference">
              <span>{method === "TRANSFER" ? "Referencia / folio de la transferencia" : "Referencia (opcional)"}</span>
              <input id="delivery-reference" className="input" name="reference" maxLength={120} placeholder={method === "TRANSFER" ? "Ej. 0123456 o últimos dígitos" : ""} />
            </label>
            {method === "TRANSFER" ? (
              <>
                <PhotoField idPrefix="delivery-proof" label="Foto del comprobante" state={photo} hint="Opcional pero recomendada: la dueña la revisa para validar." />
                <p className="staff-note">
                  La transferencia queda <strong>reportada</strong>: no cuenta como pagada hasta que la dueña la valide en Cobranza.
                </p>
              </>
            ) : (
              <p className="staff-note">El efectivo queda registrado a tu nombre, en tu caja de hoy.</p>
            )}
            {amount > 0 && chosen.length > 1 ? (
              <p className="staff-hint">
                Se aplica por ticket: {shares.filter((share) => share.shareCents > 0).map((share) => `${share.ticketNumber} ${formatMoney(share.shareCents)}`).join(" · ")}
              </p>
            ) : null}
          </>
        ) : (
          <input type="hidden" name="amount" value="0" />
        )}
      </section>

      <section className="staff-card staff-step">
        <h2>
          <span className="staff-step-number">3</span> ¿Quién recibe?
        </h2>
        <div className="staff-segmented" role="radiogroup" aria-label="Quién recibe">
          <label className={receivedBy === "CLIENT" ? "active" : ""} htmlFor="received-client">
            <input id="received-client" type="radio" name="receivedBy" value="CLIENT" checked={receivedBy === "CLIENT"} onChange={() => setReceivedBy("CLIENT")} />
            {delivery.clientName.split(" ")[0] || "La clienta"}
          </label>
          <label className={receivedBy === "OTHER" ? "active" : ""} htmlFor="received-other">
            <input id="received-other" type="radio" name="receivedBy" value="OTHER" checked={receivedBy === "OTHER"} onChange={() => setReceivedBy("OTHER")} />
            Otra persona
          </label>
        </div>
        {receivedBy === "OTHER" ? (
          <div className="staff-two">
            <label className="field" htmlFor="receiver-name">
              <span>Nombre de quien recibe *</span>
              <input id="receiver-name" className="input" name="receiverName" required maxLength={120} />
            </label>
            <label className="field" htmlFor="receiver-relationship">
              <span>Relación con la clienta *</span>
              <input id="receiver-relationship" className="input" name="receiverRelationship" required maxLength={80} placeholder="Ej. hermana, esposo, recepción" />
            </label>
          </div>
        ) : null}
      </section>

      <section className="staff-card staff-step">
        <h2>
          <span className="staff-step-number">4</span> Confirmar entrega
        </h2>
        <dl className="staff-summary">
          <div>
            <dt>Artículos</dt>
            <dd>{chosen.reduce((sum, item) => sum + item.quantity, 0)} pieza(s) en {chosen.length} ticket(s)</dd>
          </div>
          <div>
            <dt>Cobro</dt>
            <dd>{amount > 0 ? `${formatMoney(amount)} · ${method === "CASH" ? "efectivo" : "transferencia reportada"}` : "Sin cobro"}</dd>
          </div>
          <div>
            <dt>Saldo que queda</dt>
            <dd className={remaining > 0 ? "staff-warning" : ""}>{formatMoney(Math.max(remaining, 0))}</dd>
          </div>
        </dl>
        {remaining > 0 && amount <= balance ? (
          <label className="staff-ack" htmlFor="balance-ack">
            <input id="balance-ack" type="checkbox" name="balanceAcknowledged" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>
              Entregar con saldo pendiente de <strong>{formatMoney(remaining)}</strong>. Queda registrado y la dueña lo ve en Cobranza.
            </span>
          </label>
        ) : null}
        <label className="field" htmlFor="delivery-notes">
          <span>{amount === 0 && balance > 0 ? "Nota: ¿por qué no se cobró? *" : "Observaciones"}</span>
          <textarea id="delivery-notes" className="input textarea" name="notes" maxLength={500} rows={2} required={amount === 0 && balance > 0} />
        </label>
        {problems.length ? (
          <ul className="staff-problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        <FormMessage state={state} />
        <button
          type="submit"
          className="button button-primary button-full staff-confirm"
          disabled={pending || photo.busy || problems.length > 0 || (remaining > 0 && !acknowledged)}
        >
          {pending ? "Confirmando…" : "Confirmar entrega"}
        </button>
        <p className="staff-hint">Una entrega confirmada ya no se puede editar ni borrar desde este panel.</p>
      </section>
    </form>
  );
}
