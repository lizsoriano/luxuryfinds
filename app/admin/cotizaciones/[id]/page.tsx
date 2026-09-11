import { notFound } from "next/navigation";
import { ConfirmAction } from "../../../../components/admin/ConfirmAction";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { businessToday, formatDate, formatDateTime, formatMoney } from "../../../../lib/format";
import { getOpenCashSession } from "../../../../lib/supabase/admin-commerce";
import {
  getQuoteDetail,
  isQuoteExpired,
  QUOTES_UNAVAILABLE_MESSAGE,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_TONES,
} from "../../../../lib/supabase/admin-quotes";
import { cancelQuoteAction, convertQuoteToOrderAction, sendQuoteAction } from "../actions";
import { ConvertToSaleDialog } from "../ConvertToSaleDialog";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail;
  try {
    detail = await getQuoteDetail(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    const missingTable = message.includes("does not exist") || message.includes("schema cache");
    return (
      <main className="admin-content">
        <PageHeader eyebrow="GESTIONA TU NEGOCIO" title="Cotización" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            {missingTable ? QUOTES_UNAVAILABLE_MESSAGE : `No pudimos cargar la cotización: ${message}`}
          </p>
        </Card>
      </main>
    );
  }
  if (!detail) notFound();

  const { quote, client, items, totalCents, convertedSaleNumber } = detail;
  const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : "Clienta eliminada";
  const expired = isQuoteExpired(quote.status, quote.valid_until, businessToday());
  const isOpen = quote.status === "DRAFT" || quote.status === "SENT";
  const openCashSession = isOpen ? await getOpenCashSession() : null;

  // A quote is a price promise, so the panel says out loud when the catalogue has
  // moved since it was built — converting still honours the quoted price.
  const drifted = items.filter(
    (item) => item.currentPriceCents !== null && item.currentPriceCents !== item.unit_price_cents,
  );
  const inactive = items.filter((item) => !item.productActive || !item.variantActive);

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="GESTIONA TU NEGOCIO"
        title={`Cotización ${quote.id.slice(0, 8).toUpperCase()}`}
        description={`${clientName}${client?.phone ? ` · ${client.phone}` : ""}${client?.email ? ` · ${client.email}` : ""}`}
        action={
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button href="/admin/cotizaciones" variant="secondary" size="small">
              Volver
            </Button>
            {isOpen && (
              <>
                <ConfirmAction
                  action={sendQuoteAction}
                  fields={{ id: quote.id }}
                  triggerLabel={quote.status === "SENT" ? "Reenviar a la clienta" : "Enviar a la clienta"}
                  title="Enviar la cotización"
                  description={
                    client?.telegram_chat_id
                      ? `Se le manda por Telegram a ${clientName} el desglose con precios y la vigencia, y la cotización queda marcada como enviada.`
                      : `${clientName} no tiene Telegram vinculado: la cotización quedará marcada como enviada, pero tendrás que pasarle el presupuesto por otro medio.`
                  }
                  confirmLabel="Marcar como enviada"
                  variant="primary"
                />
                <ConfirmAction
                  action={convertQuoteToOrderAction}
                  fields={{ id: quote.id }}
                  triggerLabel="Convertir a pedido"
                  title="Convertir en pedido"
                  description={`Se crea un pedido en borrador con estos ${items.length} artículo(s) a los precios cotizados. Todavía no descuenta inventario: eso pasa cuando confirmes el pedido desde su detalle.`}
                  confirmLabel="Crear pedido"
                  variant="primary"
                />
                <ConvertToSaleDialog
                  quoteId={quote.id}
                  totalCents={totalCents}
                  hasOpenCashSession={Boolean(openCashSession)}
                />
                <ConfirmAction
                  action={cancelQuoteAction}
                  fields={{ id: quote.id }}
                  triggerLabel="Cancelar"
                  title="Cancelar cotización"
                  description="La cotización quedará cancelada y ya no se podrá enviar ni convertir."
                  confirmLabel="Cancelar cotización"
                  variant="danger"
                />
              </>
            )}
          </span>
        }
      />

      <Card className="admin-panel" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <p className="micro-label">DETALLE</p>
            <h2>Artículos</h2>
          </div>
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {expired && <Badge tone="danger">Vencida</Badge>}
            <Badge tone={QUOTE_STATUS_TONES[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
          </span>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Variante</th>
                <th>Entrega</th>
                <th className="numeric">Cantidad</th>
                <th className="numeric">Precio cotizado</th>
                <th className="numeric">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.productName ?? "Producto eliminado"}
                    {!item.productActive || !item.variantActive ? (
                      <span className="admin-cell-sub">Ya no está activo en el catálogo</span>
                    ) : null}
                  </td>
                  <td style={{ color: "var(--admin-muted)" }}>{item.variantName ?? "—"}</td>
                  <td style={{ color: "var(--admin-muted)" }}>
                    {item.catalogType === "IMMEDIATE" ? "Entrega inmediata" : item.catalogType === "ON_DEMAND" ? "Por pedido" : "—"}
                  </td>
                  <td className="numeric">{item.quantity}</td>
                  <td className="numeric">
                    {formatMoney(item.unit_price_cents)}
                    {item.currentPriceCents !== null && item.currentPriceCents !== item.unit_price_cents ? (
                      <span className="admin-cell-sub">Hoy: {formatMoney(item.currentPriceCents)}</span>
                    ) : null}
                  </td>
                  <td className="numeric">{formatMoney(item.unit_price_cents * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ textAlign: "right", fontWeight: 600 }}>
                  Total
                </td>
                <td className="numeric" style={{ fontWeight: 600 }}>
                  {formatMoney(totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="admin-hint" style={{ marginTop: 12 }}>
          Vigente hasta el <strong>{formatDate(quote.valid_until)}</strong>
          {expired ? " · ya venció, pero todavía puedes convertirla si la clienta acepta." : "."}
        </p>
        {quote.notes && (
          <p className="admin-hint" style={{ marginTop: 8 }}>
            Nota para la clienta: {quote.notes}
          </p>
        )}
        {drifted.length > 0 && isOpen && (
          <div className="admin-notice">
            <strong>El catálogo cambió de precio.</strong>
            {drifted.length} artículo(s) valen hoy algo distinto a lo cotizado. Si la conviertes, se respeta el precio
            cotizado; si prefieres cobrar el precio nuevo, cancélala y arma otra.
          </div>
        )}
        {inactive.length > 0 && isOpen && (
          <div className="admin-notice">
            <strong>Hay artículos dados de baja.</strong>
            {inactive.length} artículo(s) ya no están activos en el catálogo, así que esta cotización no se puede
            convertir tal cual. Reactívalos desde Productos o cancela la cotización.
          </div>
        )}
      </Card>

      {quote.status === "CONVERTED" && (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <div className="section-heading">
            <div>
              <p className="micro-label">RESULTADO</p>
              <h2>En qué se convirtió</h2>
            </div>
            {quote.converted_order_id ? (
              <Button href={`/admin/pedidos/${quote.converted_order_id}`} variant="secondary" size="small">
                Ver pedido
              </Button>
            ) : (
              <Button href="/admin/balance" variant="secondary" size="small">
                Ver en Balance
              </Button>
            )}
          </div>
          <p className="admin-hint" style={{ marginTop: 10 }}>
            {quote.converted_order_id
              ? `Se convirtió en el pedido ${quote.converted_order_id.slice(0, 8).toUpperCase()} el ${formatDateTime(quote.converted_at)}.`
              : `Se convirtió en la venta ${convertedSaleNumber ?? "directa"} el ${formatDateTime(quote.converted_at)}.`}
          </p>
        </Card>
      )}

      {quote.status === "CANCELLED" && (
        <Card className="admin-panel" style={{ marginTop: 20 }}>
          <p className="micro-label">CANCELADA</p>
          <p className="admin-hint" style={{ marginTop: 10 }}>
            Esta cotización se canceló el {formatDateTime(quote.cancelled_at)} y queda solo como historial.
          </p>
        </Card>
      )}

      <p className="admin-hint" style={{ marginTop: 16 }}>
        Creada el {formatDateTime(quote.created_at)}
        {quote.sent_at ? ` · Enviada el ${formatDateTime(quote.sent_at)}` : ""}
      </p>
    </main>
  );
}
