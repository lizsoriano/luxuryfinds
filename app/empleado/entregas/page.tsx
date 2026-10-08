import Link from "next/link";
import { formatDate } from "../../../lib/format";
import { listScheduledDeliveries } from "../../../lib/supabase/staff-deliveries";
import { DeliveryCard } from "./DeliveryCard";

export const dynamic = "force-dynamic";

type SearchParams = { dia?: string; q?: string };

function addDays(day: string, days: number) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function StaffDeliveriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const search = (sp.q ?? "").trim();
  const requested = sp.dia ?? "";

  let result;
  try {
    // Day filtering needs "today" in the business timezone, which the reader returns.
    result = await listScheduledDeliveries({ search });
  } catch (error) {
    return (
      <main className="staff-content">
        <h1 className="staff-title">Entregas programadas</h1>
        <p className="form-message form-error" role="alert">
          No pudimos cargar las entregas: {error instanceof Error ? error.message : "error desconocido"}
        </p>
      </main>
    );
  }

  const today = result.today;
  const tomorrow = addDays(today, 1);
  const day =
    requested === "hoy" ? today : requested === "manana" ? tomorrow : /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : null;
  const inRange = day ? result.deliveries.filter((delivery) => delivery.day === day) : result.deliveries;
  // Client requests the owner has not confirmed (migration 020) are listed apart and never delivered.
  const deliveries = inRange.filter((delivery) => !delivery.pendingConfirmation);
  const awaitingOwner = inRange.filter((delivery) => delivery.pendingConfirmation && delivery.day >= today);

  const byDay = new Map<string, typeof deliveries>();
  for (const delivery of deliveries) byDay.set(delivery.day, [...(byDay.get(delivery.day) ?? []), delivery]);

  const chip = (value: string, label: string) => {
    const params = new URLSearchParams();
    if (value) params.set("dia", value);
    if (search) params.set("q", search);
    const active = (value || "") === (requested === "" ? "" : requested);
    return (
      <Link key={value || "todas"} className={active ? "staff-chip active" : "staff-chip"} href={`/empleado/entregas${params.toString() ? `?${params}` : ""}`}>
        {label}
      </Link>
    );
  };

  return (
    <main className="staff-content">
      <div className="staff-heading">
        <div>
          <p className="staff-eyebrow">Agenda</p>
          <h1 className="staff-title">Entregas programadas</h1>
        </div>
      </div>

      <nav className="staff-chips" aria-label="Filtrar por día">
        {chip("", "Todas pendientes")}
        {chip("hoy", "Hoy")}
        {chip("manana", "Mañana")}
      </nav>

      <form className="staff-search" method="get" action="/empleado/entregas" role="search">
        {requested ? <input type="hidden" name="dia" value={requested} /> : null}
        <label htmlFor="staff-delivery-search" className="sr-only">
          Buscar clienta
        </label>
        <input id="staff-delivery-search" className="input" type="search" name="q" defaultValue={search} placeholder="Buscar clienta o celular…" />
        <button type="submit" className="button button-secondary">
          Buscar
        </button>
      </form>
      <form className="staff-date-filter" method="get" action="/empleado/entregas">
        {search ? <input type="hidden" name="q" value={search} /> : null}
        <label className="field" htmlFor="staff-delivery-day">
          <span>Otro día</span>
          <input id="staff-delivery-day" className="input" type="date" name="dia" defaultValue={day ?? ""} />
        </label>
        <button type="submit" className="button button-secondary">
          Ver
        </button>
      </form>

      {byDay.size ? (
        [...byDay.entries()].map(([groupDay, list]) => (
          <section key={groupDay} className="staff-day">
            <h2 className={groupDay < today ? "staff-day-title staff-day-late" : "staff-day-title"}>
              {groupDay === today ? "Hoy" : groupDay === tomorrow ? "Mañana" : formatDate(groupDay)}
              {groupDay < today ? " · pendiente de días anteriores" : ""}
              <small>{list.length} entrega(s)</small>
            </h2>
            <div className="staff-list">
              {list.map((delivery) => (
                <DeliveryCard key={delivery.id} delivery={delivery} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="staff-empty">
          <strong>Sin entregas {day === today ? "hoy" : day === tomorrow ? "mañana" : day ? "ese día" : "pendientes"}</strong>
          <p>Las citas que la dueña agenda en la Agenda aparecen aquí.</p>
        </div>
      )}
      {awaitingOwner.length ? (
        <section className="staff-day">
          <h2 className="staff-day-title">
            Por confirmar por la dueña
            <small>{awaitingOwner.length} solicitud(es)</small>
          </h2>
          <p className="staff-hint">Horarios que apartaron las clientas. Aparecen arriba, listos para entregar, cuando la dueña los confirme.</p>
          <div className="staff-list">
            {awaitingOwner.map((delivery) => (
              <DeliveryCard key={delivery.id} delivery={delivery} />
            ))}
          </div>
        </section>
      ) : null}
      {result.capped ? <p className="staff-hint">Se muestran las primeras 500 citas pendientes.</p> : null}
    </main>
  );
}
