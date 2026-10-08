import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { businessToday, formatTime } from "../../../lib/format";
import { listSlotsForDay, listLocations, type SlotBooking } from "../../../lib/supabase/admin-agenda";
import { listTicketsByLogistics } from "../../../lib/supabase/admin-orders";
import { listPendingRequests, type PendingRequest } from "../../../lib/supabase/delivery-requests";
import { completeBookingAction, confirmDeliveryRequestAction } from "./actions";
import { BookSlotDialog } from "./BookSlotDialog";
import { CancelBookingDialog } from "./CancelBookingDialog";
import { DeliveryRequests } from "./DeliveryRequests";
import { NewLocationDialog } from "./NewLocationDialog";
import { PublishAvailabilityDialog } from "./PublishAvailabilityDialog";
import { RejectRequestDialog } from "./RejectRequestDialog";

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

  // Client requests waiting for the owner (migration 020). Without it the
  // section only explains how to turn it on; the rest of the Agenda is unchanged.
  let requests: { available: boolean; requests: PendingRequest[] } = { available: false, requests: [] };
  let requestsError: string | null = null;
  try {
    requests = await listPendingRequests();
  } catch (error) {
    requestsError = error instanceof Error ? error.message : "error desconocido";
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="VENDER"
        title="Agenda de entregas"
        description="Confirma o rechaza las visitas que apartan las clientas (10 minutos por visita), publica disponibilidad por ubicación, agenda tickets listos para entrega y márcalos completados el día de la cita."
        action={<NewLocationDialog />}
      />

      <DeliveryRequests available={requests.available} requests={requests.requests} error={requestsError} />

      {!locations.length ? (
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <EmptyState title="Aún no tienes ubicaciones de entrega" description="Crea una para empezar a publicar disponibilidad." />
        </Card>
      ) : (
        <AgendaBody
          locationId={locationId as string}
          locations={locations}
          date={date}
          pendingByVisit={new Map(requests.requests.map((request) => [request.visitId, request]))}
        />
      )}
    </main>
  );
}

async function AgendaBody({
  locationId,
  locations,
  date,
  pendingByVisit,
}: {
  locationId: string;
  locations: Array<{ id: string; name: string; address: string }>;
  date: string;
  pendingByVisit: Map<string, PendingRequest>;
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
  const pendingCount = slots.filter((slot) => slot.bookings.some((booking) => booking.pending)).length;

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
            {pendingCount ? <p className="admin-hint">{pendingCount} horario(s) apartado(s) por confirmar.</p> : null}
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
                {slots.flatMap((slot) => {
                  // One visit can hold several tickets in the same 10-minute slot: one row each.
                  const rows: Array<SlotBooking | null> = slot.bookings.length ? slot.bookings : [null];
                  return rows.map((booking, index) => {
                    const firstOfVisit = booking ? rows.findIndex((other) => other?.visitId === booking.visitId) === index : true;
                    const pendingVisit = booking?.pending ? pendingByVisit.get(booking.visitId) : undefined;
                    return (
                      <tr key={booking?.bookingId ?? slot.id} className={booking?.pending ? "agenda-row-pending" : undefined}>
                        <td className="admin-cell-time">{index === 0 ? formatTime(slot.starts_at) : ""}</td>
                        <td>
                          {!booking ? (
                            <Badge tone="success">Disponible</Badge>
                          ) : booking.status === "COMPLETED" ? (
                            <Badge tone="neutral">Completada</Badge>
                          ) : booking.pending ? (
                            <Badge tone="warning">Por confirmar</Badge>
                          ) : (
                            <Badge tone="rose">Confirmada</Badge>
                          )}
                        </td>
                        <td className="admin-cell-nowrap">
                          {booking ? (
                            <>
                              {booking.ticketNumber}
                              <span className="admin-cell-sub">{booking.productName}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="admin-cell-muted admin-cell-name">{booking?.clientName ?? "—"}</td>
                        <td className="admin-cell-muted admin-cell-nowrap">{booking ? (booking.deliveryType === "PICKUP" ? "Recoger" : "DiDi") : "—"}</td>
                        <td>
                          <div className="admin-row-actions">
                            {!booking ? (
                              <BookSlotDialog slotId={slot.id} startsAt={slot.starts_at} tickets={bookableTickets} />
                            ) : booking.status === "BOOKED" && booking.pending ? (
                              firstOfVisit ? (
                                <>
                                  <RejectRequestDialog visitId={booking.visitId} clientName={booking.clientName} when={formatTime(slot.starts_at)} />
                                  {pendingVisit?.expired ? null : (
                                    <ConfirmAction
                                      action={confirmDeliveryRequestAction}
                                      fields={{ visitId: booking.visitId }}
                                      triggerLabel="Confirmar"
                                      title={`Confirmar cita · ${booking.clientName}`}
                                      description={`${formatTime(slot.starts_at)}: los productos de esta visita pasan a "Entrega programada" y le avisamos a la clienta que ya puede pasar.`}
                                      confirmLabel="Confirmar cita"
                                      variant="primary"
                                    />
                                  )}
                                </>
                              ) : (
                                <span className="admin-cell-muted">Misma visita</span>
                              )
                            ) : booking.status === "BOOKED" ? (
                              <>
                                <ConfirmAction
                                  action={completeBookingAction}
                                  fields={{ bookingId: booking.bookingId }}
                                  triggerLabel="Completar"
                                  title="Marcar entrega completada"
                                  description={`El ticket ${booking.ticketNumber} pasará a "Entregado".`}
                                  confirmLabel="Completar"
                                  variant="primary"
                                />
                                <CancelBookingDialog bookingId={booking.bookingId} ticketNumber={booking.ticketNumber} />
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  });
                })}
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
