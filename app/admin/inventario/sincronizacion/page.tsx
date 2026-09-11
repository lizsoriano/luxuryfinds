import { ConfirmAction } from "../../../../components/admin/ConfirmAction";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { StatCard } from "../../../../components/ui/StatCard";
import { formatDateTime, formatMoney } from "../../../../lib/format";
import { loadSyncDashboard, type SourceCard, type SyncRunRow } from "../../../../lib/sync/report";
import { SOURCE_HOMEPAGES } from "../../../../lib/sync/types";
import { resetSyncCursorAction, resolveMatchReviewAction, runSyncNowAction } from "./actions";
import { SyncNowButton } from "./SyncNowButton";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  completed: "success",
  partial: "warning",
  failed: "danger",
  running: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Completada",
  partial: "Parcial",
  failed: "Falló",
  running: "En curso",
};

function money(cents: number | null | undefined) {
  return cents === null || cents === undefined ? "—" : formatMoney(cents);
}

/** Which store's price the MAX() rule ended up applying, in plain words. */
function winnerLabel(applied: number | null, mawmaw: number | null, oskin: number | null) {
  if (applied === null) return "—";
  const matchesMawMaw = mawmaw !== null && mawmaw === applied;
  const matchesOskin = oskin !== null && oskin === applied;
  if (matchesMawMaw && matchesOskin) return "Ambas";
  if (matchesMawMaw) return "Maw Maw";
  if (matchesOskin) return "Oskin";
  return "Luxury Finds";
}

/**
 * How far through the store's catalogue the crawl has got. One invocation only
 * ever covers a slice (the serverless time limit), so without this the panel
 * could only say "última sincronización: hace 3 minutos" while the sync silently
 * re-read the same first pages forever - which is exactly what it used to do.
 */
function CatalogProgress({ card }: { card: SourceCard }) {
  const done = Math.max(0, card.cursorPage - 1);
  const total = Math.max(card.estimatedPages, card.cursorPage);
  const percent = Math.min(100, Math.round((done / total) * 100));
  const finished = card.cursorWrapped;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span className="admin-hint">Avance del catálogo</span>
        <span className="admin-hint">
          {finished
            ? "catálogo recorrido completo · vuelve a empezar"
            : `página ${card.cursorPage} de ~${card.estimatedPages}`}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: "var(--admin-border, #e7e2e4)",
          overflow: "hidden",
        }}
        role="progressbar"
        aria-valuenow={finished ? 100 : percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Avance del catálogo de ${card.label}`}
      >
        <div
          style={{
            width: `${finished ? 100 : Math.max(percent, done > 0 ? 3 : 0)}%`,
            height: "100%",
            background: "var(--admin-accent, #b3607a)",
          }}
        />
      </div>
      <p className="admin-hint" style={{ margin: "6px 0 0" }}>
        {card.cursorUpdatedAt
          ? `Cada corrida continúa donde quedó la anterior. Última vez que avanzó: ${formatDateTime(card.cursorUpdatedAt)}.`
          : "Todavía no hay avance guardado: la próxima corrida empieza desde la página 1."}
      </p>
    </div>
  );
}

function SourcePanel({ card }: { card: SourceCard }) {
  const run = card.lastRun;
  return (
    <Card className="admin-panel" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>{card.label}</h2>
          <a className="admin-hint" href={SOURCE_HOMEPAGES[card.source]} target="_blank" rel="noreferrer noopener">
            {SOURCE_HOMEPAGES[card.source].replace("https://", "")}
          </a>
        </div>
        {run ? (
          <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{STATUS_LABEL[run.status] ?? run.status}</Badge>
        ) : (
          <Badge tone="neutral">Sin sincronizar</Badge>
        )}
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, margin: 0 }}>
        <div>
          <dt className="admin-hint">Productos encontrados</dt>
          <dd style={{ margin: 0, fontSize: 20, fontWeight: 750 }}>{card.productsFound}</dd>
        </div>
        <div>
          <dt className="admin-hint">Productos vinculados</dt>
          <dd style={{ margin: 0, fontSize: 20, fontWeight: 750 }}>{card.productsLinked}</dd>
        </div>
        <div>
          <dt className="admin-hint">Variantes vinculadas</dt>
          <dd style={{ margin: 0, fontSize: 20, fontWeight: 750 }}>{card.variantsLinked}</dd>
        </div>
        <div>
          <dt className="admin-hint">Precios subidos (última)</dt>
          <dd style={{ margin: 0, fontSize: 20, fontWeight: 750 }}>{run?.prices_increased ?? 0}</dd>
        </div>
      </dl>

      <CatalogProgress card={card} />

      <p className="admin-hint" style={{ margin: 0 }}>
        Última sincronización: {run ? formatDateTime(run.finished_at ?? run.started_at) : "nunca"}
        <br />
        Próxima automática: {card.nextRunAt ? formatDateTime(card.nextRunAt) : "en cuanto corra el cron"}
        <br />
        Último contacto con la tienda: {card.lastSeenAt ? formatDateTime(card.lastSeenAt) : "—"}
      </p>

      <div className="admin-row-actions">
        <SyncNowButton action={runSyncNowAction} source={card.source} label={card.label} />
        <ConfirmAction
          action={resetSyncCursorAction}
          fields={{ source: card.source }}
          triggerLabel="Reiniciar avance"
          title={`Volver al inicio del catálogo de ${card.label}`}
          description="La próxima sincronización empezará otra vez desde la página 1 en lugar de continuar donde quedó. No borra ni modifica ningún producto."
          confirmLabel="Reiniciar"
          variant="secondary"
        />
      </div>
    </Card>
  );
}

function RunRow({ run }: { run: SyncRunRow }) {
  return (
    <tr>
      <td>
        <strong>{run.source === "mawmaw" ? "Maw Maw" : "Oskin"}</strong>
        <span className="admin-cell-sub">{run.sync_type}</span>
      </td>
      <td>
        <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{STATUS_LABEL[run.status] ?? run.status}</Badge>
      </td>
      <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(run.started_at)}</td>
      <td className="numeric">{run.products_scanned}</td>
      <td className="numeric">{run.products_created}</td>
      <td className="numeric">{run.products_matched}</td>
      <td className="numeric">{run.products_updated}</td>
      <td className="numeric">{run.prices_increased}</td>
      <td className="numeric">{run.products_unchanged}</td>
      <td className="numeric">{run.error_count}</td>
    </tr>
  );
}

export default async function SyncPage() {
  let dashboard;
  try {
    dashboard = await loadSyncDashboard();
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="OPERACIÓN" title="Sincronización de catálogo" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar la sincronización: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  const lastRun = dashboard.lastRuns[0] ?? null;

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="OPERACIÓN"
        title="Sincronización de catálogo"
        description="Maw Maw Beauty y Oskin se leen automáticamente y se comparan contra el catálogo de Luxury Finds. El precio publicado nunca baja solo: se aplica el más alto entre los tres."
        action={
          <Button href="/admin/inventario" variant="secondary" size="small">
            Volver a inventario
          </Button>
        }
      />

      {!dashboard.ready ? (
        <div className="admin-notice">
          <strong>Falta aplicar la migración {dashboard.missingMigration}</strong>
          Las tablas <code>product_sources</code>, <code>sync_runs</code>, <code>price_change_log</code> y{" "}
          <code>product_match_reviews</code> todavía no existen en Supabase. Abre el editor SQL del proyecto y ejecuta{" "}
          <code>database/migrations/003_product_sources_sync.sql</code> (después de 002). Mientras tanto la
          sincronización puede leer las tiendas pero no puede guardar nada.
        </div>
      ) : null}

      <section className="admin-stats">
        <StatCard
          label="INTERVALO"
          value={`${dashboard.intervalMinutes} min`}
          note="Cron en vercel.json; el endpoint también acepta un programador externo"
        />
        <StatCard
          label="ÚLTIMA CORRIDA"
          value={lastRun ? String(lastRun.products_scanned) : "—"}
          note={lastRun ? `productos revisados · ${formatDateTime(lastRun.started_at)}` : "todavía no hay corridas"}
          tone="rose"
        />
        <StatCard
          label="PRECIOS SUBIDOS"
          value={lastRun ? String(lastRun.prices_increased) : "0"}
          note="En la última corrida. Nunca se baja un precio automáticamente."
        />
        <StatCard
          label="EN REVISIÓN"
          value={String(dashboard.reviews.length)}
          note="Coincidencias dudosas esperando decisión"
          tone="warning"
        />
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        {dashboard.cards.map((card) => (
          <SourcePanel card={card} key={card.source} />
        ))}
      </div>

      <h2 style={{ margin: "28px 0 12px", fontSize: 15 }}>Resumen de las últimas corridas</h2>
      <Card className="admin-panel">
        {dashboard.lastRuns.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Fuente</th>
                  <th>Estado</th>
                  <th>Inicio</th>
                  <th className="numeric">Revisados</th>
                  <th className="numeric">Nuevos</th>
                  <th className="numeric">Vinculados</th>
                  <th className="numeric">Actualizados</th>
                  <th className="numeric">Precios ↑</th>
                  <th className="numeric">Sin cambios</th>
                  <th className="numeric">Errores</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.lastRuns.map((run) => (
                  <RunRow run={run} key={run.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Todavía no hay corridas"
            description="Usa “Sincronizar ahora” en cualquiera de las dos tiendas, o espera a que el cron la ejecute."
          />
        )}
        {lastRun?.errors?.length ? (
          <details style={{ marginTop: 14 }}>
            <summary className="admin-hint" style={{ cursor: "pointer" }}>
              Errores de la última corrida ({lastRun.error_count})
            </summary>
            <ul className="admin-hint" style={{ marginTop: 8, paddingLeft: 18 }}>
              {lastRun.errors.slice(0, 20).map((entry, index) => (
                <li key={index}>
                  <strong>{entry.stage}</strong>: {entry.message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <h2 style={{ margin: "28px 0 12px", fontSize: 15 }}>Comparador de precios</h2>
      <Card className="admin-panel">
        <p className="admin-hint" style={{ marginBottom: 14 }}>
          Precio aplicado = MAX(Luxury Finds, Maw Maw, Oskin) por variante. Cada tienda conserva su propio precio sin
          sobrescribirse.
          {dashboard.comparisonTotal > dashboard.comparisons.length
            ? ` Mostrando ${dashboard.comparisons.length} de ${dashboard.comparisonTotal} variantes vinculadas.`
            : null}
        </p>
        {dashboard.comparisons.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Variante</th>
                  <th className="numeric">Luxury Finds</th>
                  <th className="numeric">Maw Maw</th>
                  <th className="numeric">Oskin</th>
                  <th>Precio aplicado</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.comparisons.map((row) => (
                  <tr key={row.variantId ?? row.productId}>
                    <td>
                      <strong>{row.productName}</strong>
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{row.variantName}</td>
                    <td className="numeric">{money(row.appliedCents)}</td>
                    <td className="numeric">
                      {row.mawmawUrl ? (
                        <a href={row.mawmawUrl} target="_blank" rel="noreferrer noopener">
                          {money(row.mawmawCents)}
                        </a>
                      ) : (
                        money(row.mawmawCents)
                      )}
                    </td>
                    <td className="numeric">
                      {row.oskinUrl ? (
                        <a href={row.oskinUrl} target="_blank" rel="noreferrer noopener">
                          {money(row.oskinCents)}
                        </a>
                      ) : (
                        money(row.oskinCents)
                      )}
                    </td>
                    <td>
                      <Badge tone="rose">{winnerLabel(row.appliedCents, row.mawmawCents, row.oskinCents)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Aún no hay variantes vinculadas"
            description="Cuando corra la primera sincronización, aquí verás el precio de cada tienda junto al que se publicó."
          />
        )}
      </Card>

      {dashboard.priceChanges.length ? (
        <>
          <h2 style={{ margin: "28px 0 12px", fontSize: 15 }}>Últimos cambios de precio</h2>
          <Card className="admin-panel">
            <div className="admin-table-scroll">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Variante</th>
                    <th className="numeric">Antes</th>
                    <th className="numeric">Después</th>
                    <th>Origen</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.priceChanges.map((change) => (
                    <tr key={change.id}>
                      <td>
                        <strong>{change.productName}</strong>
                      </td>
                      <td style={{ color: "var(--admin-muted)" }}>{change.variantName}</td>
                      <td className="numeric">{money(change.old_price_cents)}</td>
                      <td className="numeric">
                        <strong>{money(change.new_price_cents)}</strong>
                      </td>
                      <td>
                        <Badge tone="neutral">
                          {change.source_that_caused_change === "mawmaw" ? "Maw Maw" : "Oskin"}
                        </Badge>
                      </td>
                      <td style={{ color: "var(--admin-muted)" }}>{formatDateTime(change.detected_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

      <h2 style={{ margin: "28px 0 12px", fontSize: 15 }}>Revisar coincidencias</h2>
      <Card className="admin-panel">
        <p className="admin-hint" style={{ marginBottom: 14 }}>
          La sincronización importa sola todo lo que reconoce sin dudas. Aquí solo llega lo que se parece demasiado a
          un producto que ya vendes como para decidirlo sin ti.
        </p>
        {dashboard.reviews.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>En la tienda</th>
                  <th>Se parece a</th>
                  <th>Motivo</th>
                  <th className="numeric">Precio</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {dashboard.reviews.map((review) => (
                  <tr key={review.id}>
                    <td>
                      <strong>{review.external_name}</strong>
                      <span className="admin-cell-sub">
                        {review.source === "mawmaw" ? "Maw Maw" : "Oskin"}
                        {review.external_brand ? ` · ${review.external_brand}` : ""}
                        {review.external_url ? (
                          <>
                            {" · "}
                            <a href={review.external_url} target="_blank" rel="noreferrer noopener">
                              ver en la tienda
                            </a>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td>{review.candidate_name ?? "—"}</td>
                    <td style={{ color: "var(--admin-muted)" }}>{review.reason ?? "—"}</td>
                    <td className="numeric">{money(review.external_price_cents)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <ConfirmAction
                          action={resolveMatchReviewAction}
                          fields={{ id: review.id, decision: "SAME" }}
                          triggerLabel="Son el mismo"
                          title="Vincular al producto existente"
                          description={`"${review.external_name}" quedará vinculado a "${review.candidate_name ?? ""}". No se creará otro producto y la próxima sincronización aplicará la regla de precio sobre el que ya tienes.`}
                          confirmLabel="Vincular"
                        />
                        <ConfirmAction
                          action={resolveMatchReviewAction}
                          fields={{ id: review.id, decision: "DIFFERENT" }}
                          triggerLabel="Son diferentes"
                          title="Marcar como producto distinto"
                          description={`"${review.external_name}" se dará de alta como producto nuevo en la próxima sincronización y no se volverá a preguntar.`}
                          confirmLabel="Crear como nuevo"
                          variant="secondary"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No hay coincidencias dudosas"
            description="Todo lo que las tiendas publican se pudo resolver automáticamente."
          />
        )}
      </Card>
    </main>
  );
}
