"use client";

import Link from "next/link";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SectionLabel } from "../../../components/ui/SectionLabel";
import { useCart } from "../../../lib/cart/CartContext";

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

export default function CartPage() {
  const { items, subtotalCents, updateQuantity, removeItem } = useCart();

  return (
    <main className="cart-page">
      <div className="shell">
        <SectionLabel>TU SELECCIÓN</SectionLabel>
        <h1>Carrito de compras</h1>

        {items.length === 0 ? (
          <div className="cart-empty">
            <EmptyState
              title="Tu carrito está vacío"
              description="Explora el catálogo y añade las piezas que te encanten."
              href="/catalogo"
              action="Ver catálogo"
            />
          </div>
        ) : (
          <>
            <div className="cart-list">
              {items.map((item) => (
                <Card className="cart-row" key={`${item.productId}-${item.variantId ?? "base"}`}>
                  <div className="cart-row-thumb">
                    {item.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.imageUrl} alt={item.name} />
                    ) : (
                      <span className="product-photo-fallback">{item.brand}</span>
                    )}
                  </div>
                  <div className="cart-row-info">
                    <h3>{item.name}</h3>
                    <p>{item.brand} · {money(item.priceCents)} c/u</p>
                  </div>
                  <div className="cart-row-actions">
                    <span className="cart-row-price">{money(item.priceCents * item.quantity)}</span>
                    <div className="cart-qty" role="group" aria-label={`Cantidad de ${item.name}`}>
                      <button type="button" aria-label="Restar" onClick={() => updateQuantity(item.productId, item.variantId, item.quantity - 1)}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" aria-label="Sumar" onClick={() => updateQuantity(item.productId, item.variantId, item.quantity + 1)}>+</button>
                    </div>
                    <button type="button" className="cart-remove" onClick={() => removeItem(item.productId, item.variantId)}>
                      Quitar
                    </button>
                  </div>
                </Card>
              ))}
            </div>

            <Card className="cart-summary">
              <span>Subtotal</span>
              <strong>{money(subtotalCents)}</strong>
            </Card>

            <Button href="/checkout" variant="primary" fullWidth>
              Continuar al pago <span aria-hidden>→</span>
            </Button>
            <p className="login-help" style={{ marginTop: 14 }}>
              <Link href="/catalogo">Seguir viendo el catálogo</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
