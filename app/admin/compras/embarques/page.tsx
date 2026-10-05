import Link from "next/link";
import { FilterForm } from "../../../../components/admin/FilterForm";
import { Pagination } from "../../../../components/admin/Pagination";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { StatCard } from "../../../../components/ui/StatCard";
import { businessToday, formatDate, formatMoney } from "../../../../lib/format";
import {
  getCarrierAccount,
  listShipments,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
  type CarrierAccount,
  type ListShipmentsResult,
} from "../../../../lib/supabase/admin-shipments";
import { ShipmentMigrationNotice } from "./MigrationNotice";
import { PaidDialog } from "./ShipmentForms";

export const dynamic = "force-dynamic";

type SearchParams = { estado?: string; page?: string; desde?: string; hasta?: string };

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "DRAFT", label: "En preparación" },
  { value: "IN_TRANSIT", label: "En camino" },
  { value: "PARTIALLY_RECEIVED", label: "Recibido en parte" },
  { value: "RECEIVED", label: "Recibido" },
  { value: "INCIDENTS", label: "Con dañadas o faltantes" },
  { value: "CANCELLED", label: "Cancelado" },
];

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[(month || 1) - 1]} ${year}`;
}

const isDate = (value: string | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

function addMonths(day: string, months: number) {
  const [y, m] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

function Header() {
  return (
    <PageHeader
      eyebrow="COMPRAS CON SHOPPER"
      title="Embarques"
      description="Lo que manda la paquetería a La Paz: qué viaja (de varias compras y tiendas), guía, costo de envío y llegada. Al recibir capturas lo que llegó bien, dañado o no llegó."
      action={
        <span className="shopper-header-actions">
          <Button href="/admin/compras/pendientes" variant="secondary" size="small">
            Pendientes de envío
          </Button>
          <Button href="/admin/compras/embarques/nuevo" size="small">
            Nuevo embarque <span aria-hidden>＋</span>
          </Button>
        </span>
      }
    />
  );
}

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const today = businessToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = isDate(sp.desde) ? sp.desde : monthStart;
  const to = isDate(sp.hasta) ? sp.hasta : today;
  const estado = STATUS_OPTIONS.some((option) => option.value === sp.estado) ? (sp.estado ?? "") : "";

  let result: ListShipmentsResult;
  let account: CarrierAccount;
  try {
    [result, account] = await Promise.all([
      listShipments({ status: estado || undefined, page: Number(sp.page) || 1 }),
      getCarrierAccount({ from, to: to < from ? from : to }),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <Header />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar los embarques: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  if (result.state !== "ready") {
    return (
      <main className="admin-content">
        <Header />
        <ShipmentMigrationNotice state={result.state} />
      </main>
    );
  }

  const presets = [
    { label: "Este mes", desde: monthStart, hasta: today },
    { label: "Últimos 3 meses", desde: addMonths(monthStart, -2), hasta: today },
    { label: "Este año", desde: `${today.slice(0, 4)}-01-01`, hasta: today },
    { label: "Todo", desde: "2020-01-01", hasta: today },
  ];
  const incidents = result.shipments.filter((row) => row.incidentLines > 0 && row.status !== "CANCELLED").length;

  return (
    <main className="admin-content">
      <Header />

      <Card className="admin-panel" style={{ marginTop: 24 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">CUENTA DE PAQUETERÍA</p>
            <h2>
              Gasto de envío · {formatDate(from)} – {formatDate(to)}
            </h2>
          </div>
        </div>
        <nav className="ship-presets" aria-label="Periodo">
          {presets.map((preset) => {
            const active = preset.desde === from && preset.hasta === to;
            return (
              <Link
                key={preset.label}
                className={`ship-preset${active ? " active" : ""}`}
                href={`/admin/compras/embarques?desde=${preset.desde}&hasta=${preset.hasta}${estado ? `&estado=${estado}` : ""}`}
              >
                {preset.label}
              </Link>
            );
          })}
        </nav>
        <div className="admin-stats shopper-stats">
          <StatCard label="GASTADO EN ENVÍOS" value={formatMoney(account.totalCents)} note={`${account.shippedCount} embarque(s) que ya salieron · ${account.pieces} pza(s)`} tone="rose" />
          <StatCard label="PAGADO" value={formatMoney(account.paidCents)} note="A la paquetería" />
          <StatCard label="POR PAGAR" value={formatMoney(account.unpaidCents)} note={`${account.unpaid.length} embarque(s) sin pagar`} tone={account.unpaidCents ? "warning" : "default"} />
          <StatCard label="EN PREPARACIÓN" value={formatMoney(account.draftCents)} note={`${account.draftCount} borrador(es); aún no cuentan`} />
        </div>
        {account.byMonth.length || account.byCarrier.length ? (
          <div className="ship-account-grid">
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Mes (salida)</th>
                    <th className="numeric">Embarques</th>
                    <th className="numeric">Envío</th>
                    <th className="numeric">Por pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {account.byMonth.map((month) => (
                    <tr key={month.month}>
                      <td>{monthLabel(month.month)}</td>
                      <td className="numeric">{month.count}</td>
                      <td className="numeric">{formatMoney(month.totalCents)}</td>
                      <td className="numeric">{month.unpaidCents ? formatMoney(month.unpaidCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Paquetería</th>
                    <th className="numeric">Embarques</th>
                    <th className="numeric">Envío</th>
                    <th className="numeric">Por pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {account.byCarrier.map((carrier) => (
                    <tr key={carrier.carrier}>
                      <td>{carrier.carrier}</td>
                      <td className="numeric">{carrier.count}</td>
                      <td className="numeric">{formatMoney(carrier.totalCents)}</td>
                      <td className="numeric">{carrier.unpaidCents ? formatMoney(carrier.unpaidCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="admin-hint" style={{ marginTop: 14 }}>
            Ningún embarque salió en este periodo.
          </p>
        )}
        {account.unpaid.length ? (
          <details className="shopper-details">
            <summary>Envíos por pagar ({account.unpaid.length})</summary>
            <ul className="ship-unpaid">
              {account.unpaid.map((row) => (
                <li key={row.id}>
                  <span>
                    <Link href={`/admin/compras/embarques/${row.id}`}>
                      <strong>{row.shipment_number}</strong>
                    </Link>{" "}
                    · {row.carrier} · salió {formatDate(row.cost_date)}
                  </span>
                  <strong>{formatMoney(row.shipping_cost_mxn_cents)}</strong>
                  <PaidDialog shipmentId={row.id} shipmentNumber={row.shipment_number} costCents={row.shipping_cost_mxn_cents} paid={false} paidOn={null} today={today} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="admin-hint" style={{ marginTop: 12 }}>
          Cuenta por la fecha de salida de cada embarque (los borradores, por su fecha de creación y aparte). Los cancelados no
          cuentan. El envío se reparte entre las piezas del embarque y se suma al costo de cada artículo.
        </p>
      </Card>

      {incidents ? (
        <div className="admin-notice">
          <strong>
            {incidents} embarque(s) en esta página con piezas dañadas o faltantes.
          </strong>
          Los tickets afectados se quedan en &quot;Recibido en La Paz&quot; (no pasan a listos para entrega) hasta que decidas
          qué hacer: reponer, ajustar o reembolsar.{" "}
          <Link className="assign-ticket-link" href="/admin/compras/embarques?estado=INCIDENTS">Ver solo esos</Link>
        </div>
      ) : null}

      <FilterForm action="/admin/compras/embarques">
        <input type="hidden" name="desde" value={from} />
        <input type="hidden" name="hasta" value={to} />
        <label className="field admin-toolbar-grow" htmlFor="shipments-status">
          <span>Estado</span>
          <select id="shipments-status" className="input" name="estado" defaultValue={estado}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Filtrar
          </Button>
        </div>
      </FilterForm>

      <Card className="admin-panel">
        {result.shipments.length ? (
          <ul className="ship-list">
            {result.shipments.map((row) => {
              const received = row.goodPieces + row.damagedPieces + row.missingPieces;
              const canReceive = row.status === "IN_TRANSIT" || row.status === "PARTIALLY_RECEIVED";
              return (
                <li key={row.id} className="ship-card">
                  <div className="ship-card-head">
                    <div className="ship-card-title">
                      <Link href={`/admin/compras/embarques/${row.id}`}>
                        <strong>{row.shipment_number}</strong>
                      </Link>
                      <span className="shopper-badges">
                        <Badge tone={SHIPMENT_STATUS_TONES[row.status]}>{SHIPMENT_STATUS_LABELS[row.status]}</Badge>
                        {row.incidentLines ? <Badge tone="danger">{row.incidentLines} con incidencia</Badge> : null}
                        {row.status !== "CANCELLED" ? (
                          <Badge tone={row.paid ? "success" : "neutral"}>{row.paid ? "Envío pagado" : "Envío sin pagar"}</Badge>
                        ) : null}
                      </span>
                      <small>
                        {row.carrier}
                        {row.tracking_number ? ` · guía ${row.tracking_number}` : ""} · {row.purchaseCount} compra(s)
                      </small>
                      <small>
                        {row.departed_at ? `Salió ${formatDate(row.departed_at)}` : `Creado ${formatDate(row.created_at)}`}
                        {row.estimated_arrival && !row.received_at ? ` · llega aprox. ${formatDate(row.estimated_arrival)}` : ""}
                        {row.received_at ? ` · recibido ${formatDate(row.received_at)}` : ""}
                      </small>
                    </div>
                    <Button href={`/admin/compras/embarques/${row.id}`} variant={canReceive || row.status === "DRAFT" ? "primary" : "secondary"} size="small">
                      {canReceive ? "Recibir" : row.status === "DRAFT" ? "Preparar" : "Ver"}
                    </Button>
                  </div>
                  <dl className="assign-counts">
                    <div>
                      <dt>Piezas</dt>
                      <dd>{row.expectedPieces}</dd>
                    </div>
                    <div>
                      <dt>Recibidas</dt>
                      <dd>
                        {row.goodPieces}
                        {row.damagedPieces || row.missingPieces ? <span className="ship-bad"> +{row.damagedPieces + row.missingPieces}</span> : null}
                      </dd>
                    </div>
                    <div className={row.pendingPieces && received ? "assign-counts-strong" : undefined}>
                      <dt>Pendientes</dt>
                      <dd>{row.status === "CANCELLED" ? "—" : row.pendingPieces}</dd>
                    </div>
                    <div>
                      <dt>Envío</dt>
                      <dd>{formatMoney(row.shipping_cost_mxn_cents)}</dd>
                    </div>
                    <div>
                      <dt>Mercancía</dt>
                      <dd>{formatMoney(row.goodsCostMxnCents)}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title={estado ? "Sin resultados" : "Aún no hay embarques"}
            description={
              estado
                ? "Prueba con otro estado."
                : "Cuando tu shopper mande una caja, crea el embarque: eliges qué va (asignaciones y piezas libres de cualquier compra), la paquetería, la guía y el costo de envío."
            }
            href={estado ? undefined : "/admin/compras/embarques/nuevo"}
            action={estado ? undefined : "Nuevo embarque"}
          />
        )}
        <Pagination
          basePath="/admin/compras/embarques"
          params={{ estado: estado || undefined, desde: sp.desde, hasta: sp.hasta }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hasNextPage={result.hasNextPage}
        />
        <p className="admin-hint" style={{ marginTop: 12 }}>
          Recibidas = en buen estado (+ dañadas o faltantes, en rojo). Lo pendiente sigue dentro del embarque hasta que lo
          recibas.
        </p>
      </Card>
    </main>
  );
}
