import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { businessToday, formatDateTime } from "../../../lib/format";
import { listSlotsForDay, listLocations } from "../../../lib/supabase/admin-agenda";
import { listTicketsByLogistics } from "../../../lib/supabase/admin-orders";
import { completeBookingAction } from "./actions";
import { BookSlotDialog } from "./BookSlotDialog";
import { CancelBookingDialog } from "./CancelBookingDialog";
import { NewLocationDialog } from "./NewLocationDialog";
import { PublishAvailabilityDialog } from "./PublishAvailabilityDialog";

export const dynamic = "force-dynamic";

type SearchParams = { ubicacion?: string; fecha?: string };

export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const today = businessToday();
  const date = sp.fecha || today;

  let locations;
  try {
    locations = await listLocations();
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="VENDER" title="Agenda de entregas" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar las ubicaciones: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  const locationId = sp.ubicacion && locations.some((location) => location.id === sp.ubicacion) ? sp.ubicacion : locations[0]?.id;

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="VENDER"
        title="Agenda de entregas"
        description="Publica disponibilidad por ubicación, agenda tickets listos para entrega en un horario de 10 minutos, y márcalos completados el día de la cita."
        action={<NewLocationDialog />}
      />

      {!locations.length ? (
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <EmptyState title="Aún no tienes ubicaciones de entrega" description="Crea una para empezar a publicar disponibilidad." />
        </Card>
      ) : (
        <AgendaBody locationId={locationId as string} locations={locations} date={date} />
      )}
    </main>
  );
}

async function AgendaBody({
  locationId,
  locations,
  date,
}: {
  locationId: string;
  locations: Array<{ id: string; name: string; address: string }>;
  date: string;
}) {
  let slots;
  let readyTickets;
  try {
    [slots, readyTickets] = await Promise.all([listSlotsForDay(locationId, date), listTicketsByLogistics(["READY_FOR_DELIVERY"])]);
  } catch (error) {
    return (
      <Card className="admin-panel" style={{ marginTop: 24 }}>
        <p className="form-message form-error" role="alert">
          No pudimos cargar la agenda: {error instanceof Error ? error.message : "error desconocido"}
        </p>
      </Card>
    );
  }

  const bookableTickets = readyTickets.map((ticket) => ({
    id: ticket.id,
    label: `${ticket.ticket_number} · ${ticket.product_name_snapshot} · ${ticket.clientName}`,
  }));

  return (
    <>
      <form method="get" action="/admin/agenda" className="admin-toolbar">
        <label className="field" htmlFor="agenda-location">
          <span>Ubicación</span>
          <select id="agenda-location" className="input select" name="ubicacion" defaultValue={locationId}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="agenda-date">
          <span>Día</span>
          <input id="agenda-date" className="input" type="date" name="fecha" defaultValue={date} />
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Ver
          </Button>
          <PublishAvailabilityDialog locationId={locationId} date={date} />
        </div>
      </form>

      <Card className="admin-panel">
        <div className="section-heading">
          <div>
            <p className="micro-label">HORARIOS</p>
            <h2>{slots.length} horario(s) publicado(s) ese día</h2>
          </div>
        </div>
        {slots.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Horario</th>
                  <th>Estado</th>
                  <th>Ticket</th>
                  <th>Clienta</th>
                  <th>Modalidad</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot.id}>
                    <td>{formatDateTime(slot.starts_at)}</td>
                    <td>
                      {!slot.booking ? (
                        <Badge tone="success">Disponible</Badge>
                      ) : slot.booking.status === "COMPLETED" ? (
                        <Badge tone="neutral">Completada</Badge>
                      ) : (
                        <Badge tone="warning">Reservada</Badge>
                      )}
                    </td>
                    <td>{slot.booking?.ticketNumber ?? "—"}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{slot.booking?.clientName ?? "—"}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{slot.booking ? (slot.booking.deliveryType === "PICKUP" ? "Recoger" : "DiDi") : "—"}</td>
                    <td>
                      <div className="admin-row-actions">
                        {!slot.booking ? (
                          <BookSlotDialog slotId={slot.id} startsAt={slot.starts_at} tickets={bookableTickets} />
                        ) : slot.booking.status === "BOOKED" ? (
                          <>
                            <ConfirmAction
                              action={completeBookingAction}
                              fields={{ bookingId: slot.booking.bookingId }}
                              triggerLabel="Completar"
                              title="Marcar entrega completada"
                              description={`El ticket ${slot.booking.ticketNumber} pasará a "Entregado".`}
                              confirmLabel="Completar"
                              variant="primary"
                            />
                            <CancelBookingDialog bookingId={slot.booking.bookingId} ticketNumber={slot.booking.ticketNumber} />
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin horarios ese día" description="Publica una disponibilidad para generar horarios de 10 minutos." />
        )}
      </Card>
    </>
  );
}
