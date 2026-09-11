import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { businessToday, formatDate, formatDateTime, formatMoney } from "../../../lib/format";
import {
  isQuoteExpired,
  listQuotes,
  QUOTES_UNAVAILABLE_MESSAGE,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_TONES,
} from "../../../lib/supabase/admin-quotes";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; status?: string; page?: string };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const today = businessToday();

  let result;
  try {
    result = await listQuotes({ search: sp.q?.trim() || undefined, status: sp.status, page: Number(sp.page) || 1 });
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="GESTIONA TU NEGOCIO" title="Cotizaciones" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar las cotizaciones: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="GESTIONA TU NEGOCIO"
        title="Cotizaciones"
        description="Presupuestos que todavía no son una venta: arma la lista con precios, mándasela a la clienta y, si acepta, conviértela en pedido o en venta con un clic."
        action={
          <Button href="/admin/cotizaciones/nueva" size="small">
            Nueva cotización <span aria-hidden>＋</span>
          </Button>
        }
      />

      {result.unavailable ? (
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            {QUOTES_UNAVAILABLE_MESSAGE}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Es un archivo SQL que se corre una sola vez. Hasta entonces esta pantalla no puede guardar ni leer
            cotizaciones.
          </p>
        </Card>
      ) : (
        <>
          <FilterForm action="/admin/cotizaciones">
            <label className="field admin-toolbar-grow" htmlFor="quotes-search">
              <span>Buscar</span>
              <input
                id="quotes-search"
                className="input"
                type="search"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Nombre o teléfono de la clienta…"
              />
            </label>
            <label className="field" htmlFor="quotes-status">
              <span>Estado</span>
              <select id="quotes-status" className="input" name="status" defaultValue={sp.status ?? ""}>
                <option value="">Todos</option>
                <option value="DRAFT">Borrador</option>
                <option value="SENT">Enviada</option>
                <option value="CONVERTED">Convertida</option>
                <option value="CANCELLED">Cancelada</option>
              </select>
            </label>
            <div className="admin-toolbar-actions">
              <Button type="submit" variant="secondary" size="small">
                Buscar
              </Button>
            </div>
          </FilterForm>

          <Card className="admin-panel">
            {result.quotes.length ? (
              <div className="admin-table-scroll">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Clienta</th>
                      <th className="numeric">Artículos</th>
                      <th className="numeric">Total</th>
                      <th>Vigencia</th>
                      <th>Estado</th>
                      <th>Creada</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.quotes.map((quote) => {
                      const expired = isQuoteExpired(quote.status, quote.valid_until, today);
                      return (
                        <tr key={quote.id}>
                          <td>
                            <strong>{quote.id.slice(0, 8).toUpperCase()}</strong>
                          </td>
                          <td>
                            {quote.client ? `${quote.client.first_name} ${quote.client.last_name}`.trim() : "Clienta eliminada"}
                            {quote.client?.phone ? <span className="admin-cell-sub">{quote.client.phone}</span> : null}
                          </td>
                          <td className="numeric">{quote.itemCount}</td>
                          <td className="numeric">{formatMoney(quote.totalCents)}</td>
                          <td style={{ color: "var(--admin-muted)" }}>
                            {formatDate(quote.valid_until)}
                            {expired ? (
                              <span className="admin-cell-sub">
                                <Badge tone="danger">Vencida</Badge>
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <Badge tone={QUOTE_STATUS_TONES[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
                          </td>
                          <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(quote.created_at)}</td>
                          <td>
                            <Button href={`/admin/cotizaciones/${quote.id}`} variant="secondary" size="small">
                              Ver
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={sp.q || sp.status ? "Sin resultados" : "Aún no hay cotizaciones"}
                description={
                  sp.q || sp.status
                    ? "Prueba con otro nombre, teléfono o estado."
                    : "Cuando una clienta pregunte cuánto le costaría algo, arma aquí el presupuesto con precios y vigencia."
                }
                href={sp.q || sp.status ? undefined : "/admin/cotizaciones/nueva"}
                action={sp.q || sp.status ? undefined : "Nueva cotización"}
              />
            )}
            <Pagination
              basePath="/admin/cotizaciones"
              params={{ q: sp.q, status: sp.status }}
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              hasNextPage={result.hasNextPage}
            />
          </Card>
        </>
      )}
    </main>
  );
}
