"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useCart } from "../../../lib/cart/CartContext";
import { createOrderAction, type CreateOrderResult } from "./actions";

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

export function CheckoutClient() {
  const { items, subtotalCents, clear } = useCart();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<CreateOrderResult, { success: true }> | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const response = await createOrderAction(items);
      if (!response.success) {
        setError(response.error);
        return;
      }
      clear();
      setResult(response);
    } catch {
      setError("No fue posible confirmar tu pedido. Intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <Card className="checkout-confirmation">
        <span aria-hidden style={{ fontSize: 32 }}>✓</span>
        <h2>¡Pedido confirmado!</h2>
        <p>
          Folio <strong>{result.orderId.slice(0, 8).toUpperCase()}</strong> · {result.itemsCount} artículo(s) · {money(result.totalCents)}
        </p>
        <p>Nos pondremos en contacto contigo por WhatsApp para continuar con el pago.</p>
        {result.telegramLinkUrl && (
          <Card className="telegram-card" style={{ marginTop: 18, textAlign: "left" }}>
            <p>Vincula Telegram para recibir la confirmación de tus pedidos ahí también.</p>
            <Button href={result.telegramLinkUrl} variant="secondary" size="small">Vincular Telegram</Button>
          </Card>
        )}
        <div style={{ marginTop: 22 }}>
          <Button href="/cuenta" variant="primary">Ir a mi cuenta <span aria-hidden>→</span></Button>
        </div>
      </Card>
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
    <Card>
      <div className="checkout-summary-list">
        {items.map((item) => (
          <div className="checkout-summary-row" key={`${item.productId}-${item.variantId ?? "base"}`}>
            <span>
              {item.name}
              <small>{item.brand} · x{item.quantity}</small>
            </span>
            <span>{money(item.priceCents * item.quantity)}</span>
          </div>
        ))}
      </div>
      <div className="checkout-total">
        <span>Total</span>
        <strong>{money(subtotalCents)}</strong>
      </div>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      <div style={{ marginTop: 18 }}>
        <Button type="button" variant="primary" fullWidth disabled={pending} onClick={handleConfirm}>
          {pending ? "Confirmando…" : "Confirmar pedido"} <span aria-hidden>→</span>
        </Button>
      </div>
      <p className="login-help" style={{ marginTop: 14 }}>
        <Link href="/carrito">← Volver al carrito</Link>
      </p>
    </Card>
  );
}
