"use client";

import { useActionState, useMemo, useState } from "react";
import { bookDeliveryAction } from "../../app/cuenta/entregas/actions";
import { emptyActionState } from "../../lib/actions";
import { bookableStarts } from "../../lib/account-view";
import { Icon } from "./AccountIcons";

export type SchedulerTicket = { id: string; name: string; detail: string; imageUrl: string | null; balanceText: string | null; reason?: string };
export type SchedulerSlotView = { id: string; availabilityId: string; startsAt: string; free: boolean; pickup: boolean; didi: boolean; timeLabel: string };
export type SchedulerPoint = { id: string; name: string; address: string; mapUrl: string; days: Array<{ date: string; label: string; slots: SchedulerSlotView[] }> };

/**
 * `requests` = migration 020 is applied: she reserves ONE 10-minute window for
 * everything she picked and it stays as a request until the owner confirms it.
 * Without it (019) each product still takes its own consecutive 10 minutes and
 * the appointment is confirmed right away.
 */
export function ScheduleDelivery({ tickets, blocked = [], points, reschedule = false, requests = false }: { tickets: SchedulerTicket[]; blocked?: SchedulerTicket[]; points: SchedulerPoint[]; reschedule?: boolean; requests?: boolean }) {
  const [selected, setSelected] = useState<string[]>(tickets.map((t) => t.id));
  const [pointId, setPointId] = useState(points.length === 1 ? points[0].id : "");
  const [date, setDate] = useState("");
  const [slotId, setSlotId] = useState("");
  const [mode, setMode] = useState("");
  const [state, action, pending] = useActionState(bookDeliveryAction, emptyActionState);

  const count = requests ? 1 : Math.max(1, selected.length);
  const point = points.find((p) => p.id === pointId) ?? null;
  const days = useMemo(() => (point?.days ?? []).map((day) => ({ ...day, starts: bookableStarts(day.slots, count) as SchedulerSlotView[] })).filter((day) => day.starts.length), [point, count]);
  const day = days.find((d) => d.date === date) ?? null;
  const slot = day?.starts.find((s) => s.id === slotId) ?? null;
  const modes = slot ? [slot.pickup && "PICKUP", slot.didi && "DIDI"].filter(Boolean) as string[] : [];
  const chosenMode = modes.length === 1 ? modes[0] : mode;
  const ready = selected.length > 0 && slot && modes.includes(chosenMode);

  if (state.success) {
    return requests ? (
      <div className="acc-request-state is-pending" role="status">
        <Icon name="clock" size={22} />
        <div>
          <strong>Solicitud enviada · esperando confirmación</strong>
          <p>{state.success}</p>
          <p>Te avisamos en tus avisos y, si lo vinculaste, por Telegram cuando la confirmemos. Hasta entonces el horario queda apartado para ti.</p>
        </div>
      </div>
    ) : (
      <div className="acc-success" role="status"><Icon name="check" size={22} /><div><strong>{state.success}</strong><p>Te enviamos la confirmación a tus avisos{reschedule ? "" : " y, si lo vinculaste, a Telegram"}.</p></div></div>
    );
  }

  const toggle = (id: string) => { setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); setSlotId(""); };
  let step = 0;
  return (
    <form action={action} className="acc-scheduler">
      {reschedule && <input type="hidden" name="reschedule" value="1" />}
      {selected.map((id) => <input key={id} type="hidden" name="ticketId" value={id} />)}
      <input type="hidden" name="slotId" value={slot?.id ?? ""} />
      <input type="hidden" name="deliveryType" value={chosenMode} />

      {(tickets.length > 1 || (blocked.length > 0 && tickets.length > 0)) && !reschedule && (
        <fieldset className="acc-step">
          <legend><span>{++step}</span>¿Qué vas a recibir?</legend>
          <div className="acc-choice-list">
            {tickets.map((t) => (
              <label key={t.id} className={`acc-choice acc-choice-product${selected.includes(t.id) ? " is-on" : ""}`}>
                <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.imageUrl ? <img src={t.imageUrl} alt="" className="acc-thumb acc-thumb-sm" /> : <span className="acc-thumb acc-thumb-sm acc-thumb-empty"><Icon name="bag" size={16} /></span>}
                <span><strong>{t.name}</strong><small>{t.detail}{t.balanceText ? ` · ${t.balanceText}` : ""}</small></span>
              </label>
            ))}
            {blocked.map((t) => (
              <label key={t.id} className="acc-choice acc-choice-product is-blocked" aria-disabled="true">
                <input type="checkbox" checked={false} disabled readOnly />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.imageUrl ? <img src={t.imageUrl} alt="" className="acc-thumb acc-thumb-sm" /> : <span className="acc-thumb acc-thumb-sm acc-thumb-empty"><Icon name="bag" size={16} /></span>}
                <span><strong>{t.name}</strong><small>{t.detail}</small><small className="acc-blocked-note">No disponible todavía · {t.reason ?? "aún no está listo para entrega"}</small></span>
              </label>
            ))}
          </div>
          {blocked.length > 0 && <p className="acc-muted">Solo puedes agendar los productos que ya están listos para entrega en La Paz. Los demás se habilitan cuando lleguen.</p>}
        </fieldset>
      )}
      {((tickets.length === 1 && !blocked.length) || reschedule) && (
        <div className="acc-scheduler-items">
          {tickets.map((t) => <p key={t.id}><Icon name="bag" size={16} /><span><strong>{t.name}</strong> · {t.detail}{t.balanceText ? ` · ${t.balanceText}` : ""}</span></p>)}
        </div>
      )}

      <fieldset className="acc-step" disabled={!selected.length}>
        <legend><span>{++step}</span>Elige el lugar</legend>
        <div className="acc-choice-list">
          {points.map((p) => (
            <label key={p.id} className={`acc-choice${pointId === p.id ? " is-on" : ""}`}>
              <input type="radio" name="point" checked={pointId === p.id} onChange={() => { setPointId(p.id); setDate(""); setSlotId(""); }} />
              <Icon name="pin" size={20} />
              <span><strong>{p.name}</strong><small>{p.address}</small></span>
            </label>
          ))}
        </div>
      </fieldset>

      {point && (
        <fieldset className="acc-step">
          <legend><span>{++step}</span>Elige el día</legend>
          {days.length ? (
            <div className="acc-chips" role="radiogroup" aria-label="Días disponibles">
              {days.map((d) => (
                <button key={d.date} type="button" role="radio" aria-checked={date === d.date} className={`acc-chip${date === d.date ? " is-on" : ""}`} onClick={() => { setDate(d.date); setSlotId(""); }}>{d.label}</button>
              ))}
            </div>
          ) : <p className="acc-muted">No hay horarios libres en este lugar{count > 1 ? ` para ${count} productos seguidos` : ""}. Prueba otro lugar o escríbenos.</p>}
        </fieldset>
      )}

      {day && (
        <fieldset className="acc-step">
          <legend><span>{++step}</span>Elige la hora</legend>
          <div className="acc-chips acc-chips-grid" role="radiogroup" aria-label="Horarios disponibles">
            {day.starts.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={slotId === s.id} className={`acc-chip${slotId === s.id ? " is-on" : ""}`} onClick={() => { setSlotId(s.id); setMode(""); }}>{s.timeLabel}</button>
            ))}
          </div>
          {requests
            ? <p className="acc-muted acc-window-note"><Icon name="clock" size={15} /> Reservas 10 minutos para pasar por {selected.length > 1 ? `los ${selected.length} productos que elegiste` : "tu producto"}.</p>
            : count > 1 && <p className="acc-muted">Reservamos {count * 10} minutos para tus {count} productos.</p>}
        </fieldset>
      )}

      {slot && (
        <fieldset className="acc-step">
          <legend><span>{++step}</span>¿Cómo lo recibes?</legend>
          <div className="acc-choice-list acc-choice-row">
            {modes.includes("PICKUP") && <label className={`acc-choice${chosenMode === "PICKUP" ? " is-on" : ""}`}><input type="radio" name="mode" checked={chosenMode === "PICKUP"} onChange={() => setMode("PICKUP")} /><Icon name="bag" size={20} /><span><strong>Lo recojo</strong><small>En {point?.name}</small></span></label>}
            {modes.includes("DIDI") && <label className={`acc-choice${chosenMode === "DIDI" ? " is-on" : ""}`}><input type="radio" name="mode" checked={chosenMode === "DIDI"} onChange={() => setMode("DIDI")} /><Icon name="truck" size={20} /><span><strong>Envío por DiDi</strong><small>Costo aparte; ten tu dirección al día</small></span></label>}
          </div>
        </fieldset>
      )}

      {ready && (
        <div className="acc-scheduler-summary">
          <p><Icon name="calendar" size={18} /><span><strong>{day?.label}, {slot?.timeLabel}</strong> · {point?.name}<br /><small>{chosenMode === "DIDI" ? "Envío por DiDi" : "Recoges en el punto"} · {selected.length} producto(s){requests ? " · 10 minutos" : ""}</small></span></p>
          {requests && <p className="acc-muted">Tu horario queda apartado mientras lo revisamos. Podrás pasar cuando lo confirmemos: te avisamos.</p>}
        </div>
      )}
      {state.error && <p className="form-message form-error" role="alert">{state.error}</p>}
      <button type="submit" className="button button-primary acc-btn acc-btn-full" disabled={!ready || pending}>
        {pending ? (requests ? "Enviando…" : "Agendando…") : requests ? (reschedule ? "Solicitar nuevo horario" : "Solicitar este horario") : reschedule ? "Confirmar nuevo horario" : "Confirmar mi entrega"}
      </button>
    </form>
  );
}
