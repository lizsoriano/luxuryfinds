import { FilterForm } from "../../../components/admin/FilterForm";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatCard } from "../../../components/ui/StatCard";
import {
  businessToday,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyCompact,
  PAYMENT_METHOD_LABELS,
} from "../../../lib/format";
import { getBalance, listCashSessions } from "../../../lib/supabase/admin-commerce";

export const dynamic = "force-dynamic";

type SearchParams = { tab?: string; rango?: string; desde?: string; hasta?: string };

const RANGES = [
  { value: "dia", label: "Hoy" },
  { value: "semana", label: "Últimos 7 días" },
  { value: "mes", label: "Este mes" },
  { value: "personalizado", label: "Rango personalizado" },
] as const;

function shiftDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveRange(sp: SearchParams) {
  const today = businessToday();
  const range = sp.rango ?? "mes";
  if (range === "dia") return { from: today, to: today, range };
  if (range === "semana") return { from: shiftDays(today, -6), to: today, range };
  if (range === "personalizado") {
    const from = sp.desde || shiftDays(today, -30);
    const to = sp.hasta || today;
    return { from: from <= to ? from : to, to: from <= to ? to : from, range };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today, range: "mes" };
}

const KIND_LABELS: Record<string, string> = {
  SALE: "Venta",
  FREE_SALE: "Venta libre",
  EXPENSE: "Gasto",
};

export default async function BalancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, range } = resolveRange(sp);
  const tab = sp.tab === "cajas" ? "cajas" : "transacciones";

  const [balance, cash] = await Promise.all([getBalance({ from, to }), listCashSessions()]);

  const tabHref = (value: string) => {
    const search = new URLSearchParams();
    if (value !== "transacciones") search.set("tab", value);
    search.set("rango", range);
    if (range === "personalizado") {
      search.set("desde", from);
      search.set("hasta", to);
    }
    return `/admin/balance?${search.toString()}`;
  };

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="GESTIONA TU NEGOCIO"
        title="Balance"
        description={`Ingresos y gastos del ${formatDate(from)} al ${formatDate(to)}. Incluye ventas de mostrador y ventas libres; los pagos de planes del catálogo se siguen viendo en Cobranza.`}
      />

      <section className="admin-stats">
        <StatCard
          label="BALANCE"
          value={formatMoneyCompact(balance.balanceCents)}
          note="Ventas menos gastos"
          tone={balance.balanceCents >= 0 ? "rose" : "warning"}
        />
        <StatCard
          label="VENTAS TOTALES"
          value={formatMoneyCompact(balance.salesTotalCents)}
          note={`${balance.saleCount} venta(s) completada(s)`}
        />
        <StatCard
          label="GASTOS TOTALES"
          value={formatMoneyCompact(balance.expensesTotalCents)}
          note={`${balance.expenseCount} gasto(s)`}
          tone="warning"
        />
        <StatCard
          label="MOVIMIENTOS"
          value={String(balance.transactions.length)}
          note="Registros en el periodo"
        />
      </section>

      {balance.unavailable ? (
        <div className="admin-notice">
          <strong>No hay datos que mostrar todavía.</strong>
          {balance.message}
        </div>
      ) : null}

      <FilterForm action="/admin/balance">
        <input type="hidden" name="tab" value={tab} />
        <label className="field" htmlFor="balance-range">
          <span>Periodo</span>
          <select id="balance-range" className="input select" name="rango" defaultValue={range}>
            {RANGES.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="balance-from">
          <span>Desde</span>
          <input id="balance-from" className="input" type="date" name="desde" defaultValue={from} />
        </label>
        <label className="field" htmlFor="balance-to">
          <span>Hasta</span>
          <input id="balance-to" className="input" type="date" name="hasta" defaultValue={to} />
        </label>
        <div className="admin-toolbar-actions">
          <Button type="submit" variant="secondary" size="small">
            Aplicar
          </Button>
          <Button href="/admin/vender" size="small">
            Registrar movimiento
          </Button>
        </div>
      </FilterForm>
      <p className="admin-hint" style={{ marginTop: -6, marginBottom: 10 }}>
        Las fechas &quot;Desde/Hasta&quot; solo se aplican cuando el periodo es &quot;Rango personalizado&quot;.
      </p>

      <nav className="admin-tabs" aria-label="Secciones de balance">
        <a className={tab === "transacciones" ? "active" : ""} href={tabHref("transacciones")}>
          Transacciones
        </a>
        <a className={tab === "cajas" ? "active" : ""} href={tabHref("cajas")}>
          Cierres de caja
        </a>
      </nav>

      {tab === "transacciones" ? (
        <Card className="admin-panel">
          {balance.transactions.length ? (
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Concepto</th>
                    <th>Cliente / proveedor</th>
                    <th>Registró</th>
                    <th>Método</th>
                    <th>Estado</th>
                    <th className="numeric">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.transactions.map((transaction) => (
                    <tr key={`${transaction.kind}-${transaction.id}`}>
                      <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(transaction.date)}</td>
                      <td>
                        <Badge tone={transaction.direction === "IN" ? "success" : "warning"}>
                          {KIND_LABELS[transaction.kind]}
                        </Badge>
                      </td>
                      <td>
                        <strong>{transaction.concept}</strong>
                        <span className="admin-cell-sub">{transaction.reference}</span>
                      </td>
                      <td style={{ color: "var(--admin-muted)" }}>{transaction.counterparty}</td>
                      <td style={{ color: "var(--admin-muted)" }}>{transaction.employee}</td>
                      <td style={{ color: "var(--admin-muted)" }}>
                        {PAYMENT_METHOD_LABELS[transaction.paymentMethod] ?? transaction.paymentMethod}
                      </td>
                      <td>
                        <Badge tone={transaction.status === "COMPLETED" ? "success" : "neutral"}>
                          {transaction.status === "COMPLETED" ? "Completada" : "Cancelada"}
                        </Badge>
                      </td>
                      <td className="numeric" style={{ color: transaction.direction === "IN" ? "var(--success)" : "var(--danger)" }}>
                        {transaction.direction === "IN" ? "+" : "−"}
                        {formatMoney(transaction.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Aún no tienes registros creados en esta fecha."
              description="Registra una venta o un gasto desde la pantalla Vender para verlo reflejado aquí."
              href="/admin/vender"
              action="Ir a Vender"
            />
          )}
        </Card>
      ) : (
        <Card className="admin-panel">
          {cash.unavailable ? (
            <p className="form-message form-error" role="alert">
              No fue posible leer las cajas. Aplica database/migrations/002_business_management.sql en Supabase.
            </p>
          ) : cash.sessions.length ? (
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Apertura</th>
                    <th>Cierre</th>
                    <th className="numeric">Fondo inicial</th>
                    <th className="numeric">Esperado</th>
                    <th className="numeric">Contado</th>
                    <th className="numeric">Diferencia</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cash.sessions.map((session) => {
                    const expected = session.expected_amount_cents;
                    const counted = session.closing_amount_cents;
                    const difference = expected !== null && counted !== null ? counted - expected : null;
                    return (
                      <tr key={session.id}>
                        <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(session.opened_at)}</td>
                        <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(session.closed_at)}</td>
                        <td className="numeric">{formatMoney(session.opening_amount_cents)}</td>
                        <td className="numeric">{expected === null ? "—" : formatMoney(expected)}</td>
                        <td className="numeric">{counted === null ? "—" : formatMoney(counted)}</td>
                        <td className="numeric">
                          {difference === null ? (
                            "—"
                          ) : difference === 0 ? (
                            <Badge tone="success">Sin diferencia</Badge>
                          ) : (
                            <Badge tone={difference > 0 ? "warning" : "danger"}>{formatMoney(difference)}</Badge>
                          )}
                        </td>
                        <td>
                          <Badge tone={session.status === "OPEN" ? "warning" : "neutral"}>
                            {session.status === "OPEN" ? "Abierta" : "Cerrada"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Aún no tienes registros creados en esta fecha."
              description="Abre una caja desde la pantalla Vender para empezar a registrar cierres."
              href="/admin/vender"
              action="Ir a Vender"
            />
          )}
          <p className="admin-hint" style={{ marginTop: 14 }}>
            El corte de caja compara el efectivo contado contra el esperado (fondo inicial + ventas en efectivo −
            gastos en efectivo de esa caja). Los arqueos por denominación y los turnos por empleado llegan en Fase 2.
          </p>
        </Card>
      )}
    </main>
  );
}
