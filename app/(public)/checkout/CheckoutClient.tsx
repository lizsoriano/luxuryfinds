"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Dialog } from "../../../components/ui/Dialog";
import { CancelOrder } from "../../../components/account/CancelOrder";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useCart } from "../../../lib/cart/CartContext";
import { createOrderAction, getWeeklyPlanOptionAction, type CreateOrderResult } from "./actions";

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

const WEEK_OPTIONS = [4, 6, 8, 10, 12, 16];

export function CheckoutClient() {
  const { items, subtotalCents, clear } = useCart();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<CreateOrderResult, { success: true }> | null>(null);
  const [weeklyPlanAvailable, setWeeklyPlanAvailable] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"FULL" | "WEEKLY_PLAN">("FULL");
  const [numberOfWeeks, setNumberOfWeeks] = useState(8);
  const [thanksOpen, setThanksOpen] = useState(false);
  const [orderCancelled, setOrderCancelled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // getWeeklyPlanOptionAction already returns { eligible: false } for an
    // empty cart, so there is no separate synchronous branch to fall back to.
    getWeeklyPlanOptionAction(items).then((response) => {
      if (!cancelled) setWeeklyPlanAvailable(response.eligible);
    });
    return () => {
      cancelled = true;
    };
    // items comes from localStorage and only changes shape at the points that
    // matter here (add/remove/quantity), so this intentionally does not chase
    // a new array identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const response = await createOrderAction(
        items,
        weeklyPlanAvailable ? paymentMode : "FULL",
        weeklyPlanAvailable && paymentMode === "WEEKLY_PLAN" ? numberOfWeeks : undefined,
      );
      if (!response.success) {
        setError(response.error);
        return;
      }
      clear();
      setResult(response);
      setThanksOpen(true);
    } catch {
      setError("No fue posible confirmar tu pedido. Intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  if (result && orderCancelled) {
    return (
      <Card className="checkout-confirmation">
        <h2>Pedido cancelado</h2>
        <p>
          Cancelaste el pedido <strong>{result.orderId.slice(0, 8).toUpperCase()}</strong>. No se realizó ningún cobro.
        </p>
        <div style={{ marginTop: 22 }}>
          <Button href="/catalogo" variant="primary">Volver al catálogo <span aria-hidden>→</span></Button>
        </div>
      </Card>
    );
  }

  if (result) {
    const folio = result.orderId.slice(0, 8).toUpperCase();
    return (
      <>
      <Dialog open={thanksOpen} title="¡Gracias por tu compra!" onClose={() => setThanksOpen(false)} className="checkout-thanks">
        <p className="checkout-thanks-text">En breve nos comunicaremos contigo para realizar tu pago.</p>
        <p className="checkout-thanks-folio">Folio {folio} · {result.itemsCount} artículo(s) · {money(result.totalCents)}</p>
        <div className="checkout-thanks-actions">
          <Button href={`/cuenta/compras/p-${result.orderId}`} variant="primary" fullWidth>Ver mi pedido <span aria-hidden>→</span></Button>
          <Button href="/catalogo" variant="secondary" fullWidth>Seguir comprando</Button>
        </div>
        <CancelOrder orderId={result.orderId} onCancelled={() => setOrderCancelled(true)} />
      </Dialog>
      <Card className="checkout-confirmation">
        <span aria-hidden style={{ fontSize: 32 }}>✓</span>
        <h2>¡Gracias por tu compra!</h2>
        <p>
          Folio <strong>{folio}</strong> · {result.itemsCount} artículo(s) · {money(result.totalCents)}
        </p>
        <p>En breve nos comunicaremos contigo para realizar tu pago.</p>
        {result.telegramLinkUrl && (
          <Card className="telegram-card" style={{ marginTop: 18, textAlign: "left" }}>
            <p>Vincula Telegram para recibir la confirmación de tus pedidos ahí también.</p>
            <Button href={result.telegramLinkUrl} variant="secondary" size="small">Vincular Telegram</Button>
          </Card>
        )}
        <div style={{ marginTop: 22 }}>
          <Button href="/cuenta" variant="primary">Ir a mi cuenta <span aria-hidden>→</span></Button>
        </div>
        <CancelOrder orderId={result.orderId} onCancelled={() => setOrderCancelled(true)} />
      </Card>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <div className="cart-empty">
        <EmptyState
          title="Tu carrito está vacío"
          description="Añade productos desde el catálogo antes de continuar al pago."
          href="/catalogo"
          action="Ver catálogo"
        />
      </div>
    );
  }

  return (
    <Card className="checkout-order-card">
      <div className="checkout-order-heading"><h2>Tu pedido</h2><span>{items.reduce((sum, item) => sum + item.quantity, 0)} artículos</span></div>
      <div className="checkout-summary-list">
        {items.map((item) => (
          <div className="checkout-summary-row" key={`${item.productId}-${item.variantId ?? "base"}`}>
            <div className="checkout-product">
              <span className="checkout-product-photo">
                {item.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={item.imageUrl} alt={item.name} />
                ) : <span aria-hidden="true">LF</span>}
              </span>
              <div><span className="checkout-product-name">{item.name}</span><small>{item.brand} · Cantidad: {item.quantity}</small></div>
            </div>
            <strong className="checkout-product-price">{money(item.priceCents * item.quantity)}</strong>
          </div>
        ))}
      </div>
      <div className="checkout-order-footer">
      <div className="checkout-total">
        <span>Total</span>
        <strong>{money(subtotalCents)}</strong>
      </div>

      {weeklyPlanAvailable && (
        <div className="checkout-payment-options">
          <span className="field" style={{ marginBottom: 8, display: "block" }}>
            Modalidad de pago
          </span>
          <div className="filter-tabs" role="radiogroup" aria-label="Modalidad de pago">
            <button
              type="button"
              role="radio"
              aria-checked={paymentMode === "FULL"}
              className={paymentMode === "FULL" ? "active" : ""}
              onClick={() => setPaymentMode("FULL")}
            >
              Pago completo
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={paymentMode === "WEEKLY_PLAN"}
              className={paymentMode === "WEEKLY_PLAN" ? "active" : ""}
              onClick={() => setPaymentMode("WEEKLY_PLAN")}
            >
              Plan semanal
            </button>
          </div>
          {paymentMode === "WEEKLY_PLAN" && (
            <label className="field" htmlFor="weekly-plan-weeks">
              <span>Número de semanas</span>
              <select
                className="input select"
                id="weekly-plan-weeks"
                value={numberOfWeeks}
                onChange={(event) => setNumberOfWeeks(Number(event.target.value))}
              >
                {WEEK_OPTIONS.map((weeks) => (
                  <option key={weeks} value={weeks}>
                    {weeks} semanas · {money(Math.ceil(subtotalCents / weeks))} por semana
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {error && <p className="form-message form-error" role="alert">{error}</p>}
      <div className="checkout-confirm-action">
        <Button type="button" variant="primary" fullWidth disabled={pending} onClick={handleConfirm}>
          {pending ? "Confirmando…" : "Confirmar pedido"} <span aria-hidden>→</span>
        </Button>
      </div>
      <p className="checkout-back-link">
        <Link href="/carrito">← Volver al carrito</Link>
      </p>
      </div>
    </Card>
  );
}
