import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, formatTime } from "../../../lib/format";
import { getStaffSession } from "../../../lib/supabase/auth";
import { getStaffCashForDay, listScheduledDeliveries } from "../../../lib/supabase/staff-deliveries";
import { STAFF_DELIVERIES_MIGRATION_FILE } from "../../../lib/supabase/staff-schema";
import { DeliveryCard } from "../entregas/DeliveryCard";

export const dynamic = "force-dynamic";

/**
 * "Confirmar entrega": pick the delivery you are at (today's and any still
 * pending from earlier days) and see your cash box of the day. The four-step
 * confirmation itself lives on each delivery's page.
 */
export default async function StaffConfirmPage() {
  const session = await getStaffSession();
  if (session.kind !== "authorized") notFound();

  let deliveries;
  let cash;
  try {
    [deliveries, cash] = await Promise.all([listScheduledDeliveries(), getStaffCashForDay(session.staff.id)]);
  } catch (error) {
    return (
      <main className="staff-content">
        <h1 className="staff-title">Confirmar entrega</h1>
        <p className="form-message form-error" role="alert">
          No pudimos cargar tus entregas: {error instanceof Error ? error.message : "error desconocido"}
        </p>
      </main>
    );
  }

  const due = deliveries.deliveries.filter((delivery) => delivery.day <= deliveries.today);

  return (
    <main className="staff-content">
      <div className="staff-heading">
        <div>
          <p className="staff-eyebrow">Hoy</p>
          <h1 className="staff-title">Confirmar entrega</h1>
        </div>
      </div>

      <section className="staff-card staff-cash" aria-labelledby="staff-cash-title">
        <h2 id="staff-cash-title" className="staff-section-title">
          Mi caja de hoy
        </h2>
        {cash.available ? (
          <>
            <div className="staff-cash-grid">
              <div>
                <small>Efectivo cobrado por ti</small>
                <strong>{formatMoney(cash.cashCents)}</strong>
                <span>{cash.cashCount} entrega(s)</span>
              </div>
              <div>
                <small>Transferencias reportadas</small>
                <strong>{formatMoney(cash.transferReportedCents)}</strong>
                <span>{cash.transferCount} · las valida la dueña</span>
              </div>
            </div>
            {cash.deliveries.length ? (
              <ul className="staff-history">
                {cash.deliveries.map((delivery) => (
                  <li key={delivery.id}>
                    <span className="staff-delta">{formatTime(delivery.deliveredAt)}</span>
                    <span className="staff-history-main">
                      <strong>{delivery.clientName}</strong>
                      <small>
                        {delivery.method === "CASH" ? "Efectivo" : delivery.method === "TRANSFER" ? "Transferencia" : "Sin cobro"}
                        {delivery.amountCents ? ` · ${formatMoney(delivery.amountCents)}` : ""}
                        {delivery.balanceAfterCents ? ` · quedó saldo ${formatMoney(delivery.balanceAfterCents)}` : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="staff-hint">Aún no confirmas entregas hoy.</p>
            )}
          </>
        ) : (
          <p className="staff-note">
            Tu caja aparece cuando la dueña aplique <code>{STAFF_DELIVERIES_MIGRATION_FILE}</code>.
          </p>
        )}
      </section>

      <h2 className="staff-day-title">
        Entregas por confirmar <small>{due.length}</small>
      </h2>
      {due.length ? (
        <div className="staff-list">
          {due.map((delivery) => (
            <DeliveryCard key={delivery.id} delivery={delivery} action="Confirmar esta entrega" />
          ))}
        </div>
      ) : (
        <div className="staff-empty">
          <strong>No tienes entregas pendientes para hoy</strong>
          <p>
            Revisa las próximas en <Link href="/empleado/entregas">Entregas programadas</Link>.
          </p>
        </div>
      )}
    </main>
  );
}
