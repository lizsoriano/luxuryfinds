import { FilterForm } from "../../../components/admin/FilterForm";
import { Pagination } from "../../../components/admin/Pagination";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { businessToday, formatDate, formatMoney } from "../../../lib/format";
import { listSupplierOptions } from "../../../lib/supabase/admin-contacts";
import {
  getShopperBalances,
  listGeneralPayments,
  listPurchases,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUS_TONES,
  PURCHASES_UNAVAILABLE_MESSAGE,
  SHOPPER_PAYMENT_METHOD_LABELS,
} from "../../../lib/supabase/admin-purchases";
import { formatRate, formatUsd } from "../../../lib/supabase/purchase-math";
import { PaymentDialog, VoidPaymentDialog } from "./AccountForms";

export const dynamic = "force-dynamic";

type SearchParams = { status?: string; shopper?: string; page?: string };

function MigrationNotice() {
  return (
    <Card className="admin-panel" style={{ marginTop: 24 }}>
      <p className="form-message form-error" role="alert">
        {PURCHASES_UNAVAILABLE_MESSAGE}
      </p>
      <p className="admin-hint" style={{ marginTop: 12 }}>
        Es un archivo SQL que se corre una sola vez en el editor SQL de Supabase. Crea las tablas de compras, tickets,
        artículos y abonos; hasta entonces esta pantalla no puede guardar ni leer compras. El resto del panel funciona igual.
      </p>
    </Card>
  );
}

function BalanceCell({ cents }: { cents: number }) {
  if (cents === 0) return <span style={{ color: "var(--success)" }}>Liquidado</span>;
  if (cents < 0) return <span style={{ color: "var(--success)" }}>A tu favor {formatMoney(-cents)}</span>;
  return <strong>{formatMoney(cents)}</strong>;
}

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const today = businessToday();

  let result;
  let balances;
  let generalPayments;
  let shoppers: Array<{ id: string; label: string }> = [];
  try {
    [result, balances, generalPayments, shoppers] = await Promise.all([
      listPurchases({ status: sp.status, supplierId: sp.shopper || undefined, page: Number(sp.page) || 1 }),
      getShopperBalances(),
      listGeneralPayments(),
      listSupplierOptions(),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="GESTIONA TU NEGOCIO" title="Compras con shopper" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar las compras: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  const unavailable = result.unavailable || balances.unavailable;
  const filtered = Boolean(sp.status || sp.shopper);

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="GESTIONA TU NEGOCIO"
        title="Compras con shopper"
        description="Lo que compras en tiendas de EE.UU. a través de tu shopper: captura los artículos de cada ticket, cuádralos con la foto y lleva la cuenta de lo que le debes."
        action={
          unavailable ? undefined : (
            <span className="shopper-header-actions">
              <Button href="/admin/compras/pendientes" variant="secondary" size="small">
                Pendientes de envío
              </Button>
              <Button href="/admin/compras/nueva" size="small">
                Nueva compra <span aria-hidden>＋</span>
              </Button>
            </span>
          )
        }
      />

      {unavailable ? (
        <MigrationNotice />
      ) : (
        <>
          <Card className="admin-panel" style={{ marginTop: 24 }}>
            <div className="section-heading">
              <div>
                <p className="micro-label">CUENTA CON TUS SHOPPERS</p>
                <h2>Saldo por shopper</h2>
              </div>
            </div>
            {balances.balances.length ? (
              <div className="admin-table-scroll">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th>Shopper</th>
                      <th className="numeric">Abiertas</th>
                      <th className="numeric">Confirmadas</th>
                      <th className="numeric">Le debes (total)</th>
                      <th className="numeric">Abonado</th>
                      <th className="numeric">Saldo</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {balances.balances.map((row) => (
                      <tr key={row.supplierId}>
                        <td>
                          <strong>{row.name}</strong>
                          {row.company ? <span className="admin-cell-sub">{row.company}</span> : null}
                        </td>
                        <td className="numeric">{row.openCount}</td>
                        <td className="numeric">{row.confirmedCount}</td>
                        <td className="numeric">{formatMoney(row.owedMxnCents)}</td>
                        <td className="numeric">
                          {formatMoney(row.paidMxnCents)}
                          {row.generalPaidMxnCents ? (
                            <span className="admin-cell-sub">{formatMoney(row.generalPaidMxnCents)} general</span>
                          ) : null}
                        </td>
                        <td className="numeric">
                          <BalanceCell cents={row.balanceMxnCents} />
                        </td>
                        <td>
                          <div className="admin-row-actions">
                            <Button href={`/admin/compras?shopper=${row.supplierId}`} variant="secondary" size="small">
                              Ver compras
                            </Button>
                            <PaymentDialog
                              supplierId={row.supplierId}
                              supplierName={row.name}
                              today={today}
                              triggerLabel="Abono general"
                              triggerVariant="secondary"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="admin-hint">
                Todavía no hay compras confirmadas. El saldo con cada shopper aparece aquí en cuanto confirmes la primera.
              </p>
            )}
            <p className="admin-hint" style={{ marginTop: 12 }}>
              Saldo = lo que le debes por las compras confirmadas (tickets con tax + comisión, en pesos al tipo de cambio de
              cada compra) menos tus abonos. Las compras que sigues capturando todavía no cuentan.
            </p>
            {generalPayments.length ? (
              <details className="shopper-details">
                <summary>Abonos generales ({generalPayments.length})</summary>
                <div className="admin-table-scroll">
                  <table className="admin-data-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Shopper</th>
                        <th>Método</th>
                        <th>Nota</th>
                        <th className="numeric">Monto</th>
                        <th aria-label="Acciones" />
                      </tr>
                    </thead>
                    <tbody>
                      {generalPayments.map((payment) => (
                        <tr key={payment.id} className={payment.voided_at ? "shopper-voided" : undefined}>
                          <td>{formatDate(payment.paid_on)}</td>
                          <td>{payment.supplierName}</td>
                          <td>{SHOPPER_PAYMENT_METHOD_LABELS[payment.method]}</td>
                          <td style={{ color: "var(--admin-muted)" }}>
                            {payment.note ?? "—"}
                            {payment.voided_at ? <span className="admin-cell-sub">Anulado: {payment.void_reason}</span> : null}
                          </td>
                          <td className="numeric">{formatMoney(payment.amount_mxn_cents)}</td>
                          <td>
                            {payment.voided_at ? (
                              <Badge tone="neutral">Anulado</Badge>
                            ) : (
                              <VoidPaymentDialog paymentId={payment.id} amountMxnCents={payment.amount_mxn_cents} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </Card>

          <FilterForm action="/admin/compras">
            <label className="field" htmlFor="purchases-status">
              <span>Estado</span>
              <select id="purchases-status" className="input" name="status" defaultValue={sp.status ?? ""}>
                <option value="">Todas</option>
                <option value="OPEN">Capturando</option>
                <option value="CONFIRMED">Confirmadas</option>
                <option value="CANCELLED">Canceladas</option>
              </select>
            </label>
            <label className="field admin-toolbar-grow" htmlFor="purchases-shopper">
              <span>Shopper</span>
              <select id="purchases-shopper" className="input" name="shopper" defaultValue={sp.shopper ?? ""}>
                <option value="">Todos</option>
                {shoppers.map((shopper) => (
                  <option key={shopper.id} value={shopper.id}>
                    {shopper.label}
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
            {result.purchases.length ? (
              <div className="admin-table-scroll">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Shopper</th>
                      <th>Fecha</th>
                      <th className="numeric">Con tax (USD)</th>
                      <th className="numeric">Le debes</th>
                      <th className="numeric">Saldo</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.purchases.map((purchase) => (
                      <tr key={purchase.id}>
                        <td className="admin-cell-nowrap">
                          <strong>{purchase.purchase_number}</strong>{" "}
                          <Badge tone={PURCHASE_STATUS_TONES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
                          <span className="admin-cell-sub">
                            TC {formatRate(purchase.exchange_rate)} · {purchase.commission_percent} %
                          </span>
                        </td>
                        <td>
                          {purchase.supplier?.name ?? "Shopper eliminado"}
                          <span className="admin-cell-sub">
                            {purchase.ticketCount} ticket(s) · {purchase.pieces} pza(s)
                          </span>
                        </td>
                        <td className="admin-cell-nowrap" style={{ color: "var(--admin-muted)" }}>
                          {formatDate(purchase.purchase_date)}
                        </td>
                        <td className="numeric">{formatUsd(purchase.capturedWithTaxUsdCents)}</td>
                        <td className="numeric">
                          {purchase.owedMxnCents !== null ? (
                            formatMoney(purchase.owedMxnCents)
                          ) : purchase.estimatedOwedMxnCents !== null ? (
                            <span style={{ color: "var(--admin-muted)" }}>
                              ≈ {formatMoney(purchase.estimatedOwedMxnCents)}
                              <span className="admin-cell-sub">estimado</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="numeric">
                          {purchase.balanceMxnCents !== null ? <BalanceCell cents={purchase.balanceMxnCents} /> : "—"}
                        </td>
                        <td>
                          <Button href={`/admin/compras/${purchase.id}`} variant="secondary" size="small">
                            {purchase.status === "OPEN" ? "Capturar" : "Ver"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={filtered ? "Sin resultados" : "Aún no hay compras"}
                description={
                  filtered
                    ? "Prueba con otro estado o shopper."
                    : "Abre una compra cuando tu shopper salga a comprar: eliges al shopper, el tipo de cambio y la comisión, y desde el celular capturas cada artículo."
                }
                href={filtered ? undefined : "/admin/compras/nueva"}
                action={filtered ? undefined : "Nueva compra"}
              />
            )}
            <Pagination
              basePath="/admin/compras"
              params={{ status: sp.status, shopper: sp.shopper }}
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
