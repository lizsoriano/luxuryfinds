import { FilterForm } from "../../../components/admin/FilterForm";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatCard, type StatDelta } from "../../../components/ui/StatCard";
import { businessToday, formatDate, formatMoney, formatMoneyCompact, formatQuantity } from "../../../lib/format";
import {
  compare,
  dayCountOf,
  getStats,
  previousRange,
  shiftDay,
  type StatsRange,
} from "../../../lib/supabase/admin-stats";

export const dynamic = "force-dynamic";

type SearchParams = { rango?: string; desde?: string; hasta?: string };

const RANGES = [
  { value: "dia", label: "Hoy" },
  { value: "semana", label: "Últimos 7 días" },
  { value: "mes", label: "Este mes" },
  { value: "personalizado", label: "Rango personalizado" },
] as const;

function resolveRange(sp: SearchParams): StatsRange & { range: string } {
  const today = businessToday();
  const range = sp.rango ?? "mes";
  if (range === "dia") return { from: today, to: today, range };
  if (range === "semana") return { from: shiftDay(today, -6), to: today, range };
  if (range === "personalizado") {
    const from = sp.desde || shiftDay(today, -30);
    const to = sp.hasta || today;
    return { from: from <= to ? from : to, to: from <= to ? to : from, range };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today, range: "mes" };
}

const PERCENT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const DAY_LABEL = new Intl.DateTimeFormat("es-MX", { day: "numeric", timeZone: "America/Mazatlan" });
const DAY_FULL = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mazatlan" });

function dayLabel(day: string, format: Intl.DateTimeFormat) {
  return format.format(new Date(`${day}T12:00:00Z`));
}

/** "▲ 12.4%" plus the previous figure, or an honest note when there is nothing to compare against. */
function deltaOf(current: number, previous: number, format: (cents: number) => string): StatDelta {
  const { changePercent, direction } = compare(current, previous);
  if (changePercent === null) {
    return { label: previous === 0 && current === 0 ? "Sin datos previos" : "Periodo anterior en cero", direction };
  }
  return { label: `${PERCENT.format(Math.abs(changePercent))}% vs. ${format(previous)}`, direction };
}

export default async function EstadisticasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, range } = resolveRange(sp);
  const previous = previousRange({ from, to });
  const days = dayCountOf({ from, to });

  let stats;
  try {
    stats = await getStats({ from, to });
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="GESTIONA TU NEGOCIO" title="Estadísticas" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos calcular las estadísticas: {error instanceof Error ? error.message : "error desconocido"}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Las cifras se arman con <code>tickets</code> (catálogo) y <code>sales</code> / <code>sale_items</code>{" "}
            (mostrador). Si acabas de aplicar <code>database/migrations/002_business_management.sql</code>, recarga la
            página.
          </p>
        </Card>
      </main>
    );
  }

  const { current, products, categories, clients, daily } = stats;
  const hasSales = current.saleCount > 0;
  const maxDay = daily.reduce((max, point) => (point.revenueCents > max.revenueCents ? point : max), daily[0]);
  const maxRevenue = maxDay?.revenueCents ?? 0;
  const labelEvery = Math.max(1, Math.ceil(daily.length / 16));
  const categoryMax = categories[0]?.revenueCents ?? 0;
  // The table is capped at the top 10; this counts every product actually sold.
  const distinctProducts = new Set(current.lines.map((line) => line.productId ?? line.productName)).size;

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="GESTIONA TU NEGOCIO"
        title="Estadísticas"
        description={`Comportamiento del negocio del ${formatDate(from)} al ${formatDate(to)}, comparado contra los ${days} día(s) anteriores (${formatDate(previous.from)} al ${formatDate(previous.to)}). Incluye compras del catálogo y ventas de mostrador.`}
      />

      <section className="admin-stats">
        <StatCard
          label="VENTAS DEL PERIODO"
          value={formatMoneyCompact(current.revenueCents)}
          note={`${current.saleCount} venta(s)`}
          tone="rose"
          delta={deltaOf(current.revenueCents, stats.previous.revenueCents, formatMoneyCompact)}
        />
        <StatCard
          label="UTILIDAD"
          value={formatMoneyCompact(current.marginCents)}
          note={
            current.marginPercent === null
              ? "Sin ventas que calcular"
              : `${PERCENT.format(current.marginPercent)}% de margen`
          }
          tone={current.marginCents < 0 ? "warning" : "default"}
          delta={deltaOf(current.marginCents, stats.previous.marginCents, formatMoneyCompact)}
        />
        <StatCard
          label="PIEZAS VENDIDAS"
          value={formatQuantity(current.unitCount)}
          note={`${distinctProducts} producto(s) distinto(s)`}
          delta={deltaOf(current.unitCount, stats.previous.unitCount, (value) => formatQuantity(value))}
        />
        <StatCard
          label="VENTA PROMEDIO"
          value={formatMoneyCompact(current.averageSaleCents)}
          note="Por compra registrada"
          delta={deltaOf(current.averageSaleCents, stats.previous.averageSaleCents, formatMoneyCompact)}
        />
      </section>

      {current.salesUnavailable ? (
        <div className="admin-notice">
          <strong>Faltan las ventas de mostrador.</strong>
          No fue posible leer <code>sales</code>. Aplica <code>database/migrations/002_business_management.sql</code> en
          Supabase; mientras tanto solo se cuentan las compras del catálogo.
        </div>
      ) : null}

      {hasSales && current.linesMissingCost > 0 ? (
        <div className="admin-notice">
          <strong>La utilidad está incompleta.</strong>
          {current.linesMissingCost} línea(s) vendida(s) no tienen costo registrado, así que cuentan como 100% de
          utilidad. Captura el costo de cada producto en Inventario para que el margen sea real.
        </div>
      ) : null}

      <FilterForm action="/admin/estadisticas">
        <label className="field" htmlFor="stats-range">
          <span>Periodo</span>
          <select id="stats-range" className="input select" name="rango" defaultValue={range}>
            {RANGES.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="stats-from">
          <span>Desde</span>
          <input id="stats-from" className="input" type="date" name="desde" defaultValue={from} />
        </label>
        <label className="field" htmlFor="stats-to">
          <span>Hasta</span>
          <input id="stats-to" className="input" type="date" name="hasta" defaultValue={to} />
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Aplicar
          </Button>
          <Button href="/admin/balance" variant="secondary" size="small">
            Ver balance
          </Button>
        </div>
      </FilterForm>
      <p className="admin-hint" style={{ marginTop: -6, marginBottom: 10 }}>
        Las fechas &quot;Desde/Hasta&quot; solo se aplican cuando el periodo es &quot;Rango personalizado&quot;.
      </p>

      <Card className="admin-panel">
        <div className="section-heading">
          <div>
            <p className="micro-label">VENTAS POR DÍA</p>
            <h2>{formatMoney(current.revenueCents)}</h2>
          </div>
          {maxRevenue > 0 ? (
            <p className="admin-hint">
              Mejor día: {dayLabel(maxDay.day, DAY_FULL)} con {formatMoney(maxRevenue)}
            </p>
          ) : null}
        </div>
        {maxRevenue > 0 ? (
          <div
            className="stats-chart"
            role="img"
            aria-label={`Ventas por día del ${formatDate(from)} al ${formatDate(to)}. Máximo ${formatMoney(maxRevenue)} el ${dayLabel(maxDay.day, DAY_FULL)}.`}
          >
            {daily.map((point, index) => (
              <div
                className={`stats-chart-col${point.revenueCents === 0 ? " is-empty" : ""}`}
                key={point.day}
                title={`${dayLabel(point.day, DAY_FULL)}: ${formatMoney(point.revenueCents)} · ${point.saleCount} venta(s)`}
              >
                <div className="stats-chart-bar">
                  <span style={{ height: `${Math.max(2, Math.round((point.revenueCents / maxRevenue) * 100))}%` }} />
                </div>
                <small>{index % labelEvery === 0 ? dayLabel(point.day, DAY_LABEL) : " "}</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aún no hay ventas registradas en este periodo."
            description="Cuando registres una venta en Vender o confirmes un pedido del catálogo, la gráfica se llena sola. Prueba también con un periodo más amplio."
            href="/admin/vender"
            action="Registrar una venta"
          />
        )}
      </Card>

      <section className="admin-dashboard-grid">
        <Card className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">LO MÁS VENDIDO</p>
              <h2>Productos</h2>
            </div>
          </div>
          {products.length ? (
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="numeric">Piezas</th>
                    <th className="numeric">Ingreso</th>
                    <th className="numeric">Utilidad</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.key}>
                      <td>
                        <strong>{product.name}</strong>
                        <span className="admin-cell-sub">{product.categoryName ?? "Sin categoría"}</span>
                      </td>
                      <td className="numeric">{formatQuantity(product.quantity)}</td>
                      <td className="numeric">{formatMoney(product.revenueCents)}</td>
                      <td className="numeric">
                        {product.costMissing ? (
                          <span className="admin-cell-muted" title="Este producto no tiene costo registrado.">
                            Sin costo
                          </span>
                        ) : (
                          formatMoney(product.marginCents)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Todavía no hay productos vendidos en este periodo."
              description="El ranking usa las piezas vendidas de cada producto, sumando el catálogo y el mostrador."
            />
          )}
        </Card>

        <Card className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">LO MÁS VENDIDO</p>
              <h2>Categorías</h2>
            </div>
          </div>
          {categories.length ? (
            <div className="stats-rank">
              {categories.map((category) => (
                <div className="stats-rank-row" key={category.name}>
                  <div>
                    <strong>{category.name}</strong>
                    <span>{formatMoney(category.revenueCents)}</span>
                  </div>
                  <div className="stats-rank-track">
                    <span
                      style={{ width: `${categoryMax > 0 ? Math.max(3, Math.round((category.revenueCents / categoryMax) * 100)) : 0}%` }}
                    />
                  </div>
                  <small>{formatQuantity(category.quantity)} pieza(s)</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Sin categorías vendidas."
              description="La categoría sale de la ficha del producto; las ventas libres no aparecen aquí porque no tienen producto."
            />
          )}
        </Card>
      </section>

      <section className="admin-dashboard-grid">
        <Card className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">CLIENTAS QUE MÁS COMPRAN</p>
              <h2>Ranking del periodo</h2>
            </div>
          </div>
          {clients.length ? (
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Clienta</th>
                    <th className="numeric">Compras</th>
                    <th className="numeric">Total</th>
                    <th className="numeric">Última</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.id}>
                      <td>
                        <a className="admin-cell-link" href={`/admin/clientes/${client.id}`}>
                          <span>
                            <strong>{client.name}</strong>
                            <span className="admin-cell-sub">{client.phone ?? "Sin teléfono"}</span>
                          </span>
                        </a>
                      </td>
                      <td className="numeric">{client.purchaseCount}</td>
                      <td className="numeric">{formatMoney(client.totalCents)}</td>
                      <td className="numeric admin-cell-nowrap">{formatDate(client.lastPurchaseAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Ninguna clienta compró en este periodo."
              description="Se cuentan las compras del catálogo y las ventas de mostrador asignadas a una clienta; las ventas a público general no tienen dueña."
              href="/admin/clientes"
              action="Ver clientas"
            />
          )}
        </Card>

        <Card className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="micro-label">MARGEN DE UTILIDAD</p>
              <h2>{current.marginPercent === null ? "—" : `${PERCENT.format(current.marginPercent)}%`}</h2>
            </div>
          </div>
          <div className="stats-breakdown">
            <div>
              <span>Ingresos</span>
              <strong>{formatMoney(current.revenueCents)}</strong>
            </div>
            <div>
              <span>Costo de lo vendido</span>
              <strong>−{formatMoney(current.costCents)}</strong>
            </div>
            <div>
              <span>Utilidad</span>
              <strong style={{ color: current.marginCents < 0 ? "var(--danger)" : "var(--success)" }}>
                {formatMoney(current.marginCents)}
              </strong>
            </div>
            {current.freeSaleRevenueCents > 0 ? (
              <div>
                <span>De ventas libres (sin costo)</span>
                <strong>{formatMoney(current.freeSaleRevenueCents)}</strong>
              </div>
            ) : null}
          </div>
          <p className="admin-hint" style={{ marginTop: 16 }}>
            El costo de una venta de mostrador es el que quedó guardado al momento de venderla. El de una compra del
            catálogo usa el costo actual del producto, porque el ticket no guarda una copia: si cambias el costo, el
            margen histórico se recalcula.
          </p>
        </Card>
      </section>
    </main>
  );
}
