"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SectionLabel } from "../../../components/ui/SectionLabel";
import { useCart } from "../../../lib/cart/CartContext";
import { getWeeklyPlanOptionAction } from "../checkout/actions";

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);

export default function CartPage() {
  const { items, subtotalCents, updateQuantity, removeItem } = useCart();
  const [weeklyPlanAvailable, setWeeklyPlanAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWeeklyPlanOptionAction(items).then((response) => {
      if (!cancelled) setWeeklyPlanAvailable(response.eligible);
    });
    return () => {
      cancelled = true;
    };
    // items comes from localStorage; only react to it actually changing size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

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
          <div className="cart-grid">
            <Card>
              <div className="cart-table-wrap">
                <table className="cart-table">
                  <thead>
                    <tr>
                      <th aria-label="Quitar" />
                      <th>Producto</th>
                      <th className="numeric">Precio</th>
                      <th>Cantidad</th>
                      <th className="numeric">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={`${item.productId}-${item.variantId ?? "base"}`}>
                        <td>
                          <button
                            type="button"
                            className="cart-table-remove"
                            aria-label={`Quitar ${item.name}`}
                            onClick={() => removeItem(item.productId, item.variantId)}
                          >
                            ×
                          </button>
                        </td>
                        <td>
                          <div className="cart-table-product">
                            <span className="cart-table-thumb">
                              {item.imageUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={item.imageUrl} alt={item.name} />
                              ) : (
                                item.brand
                              )}
                            </span>
                            <span>
                              <span className="cart-table-name">{item.name}</span>
                              <span className="cart-table-brand">{item.brand}</span>
                            </span>
                          </div>
                        </td>
                        <td className="numeric">{money(item.priceCents)}</td>
                        <td>
                          <input
                            className="cart-qty-input"
                            type="number"
                            min={1}
                            value={item.quantity}
                            aria-label={`Cantidad de ${item.name}`}
                            onChange={(event) => {
                              const next = Math.round(Number(event.target.value));
                              if (Number.isFinite(next) && next > 0) updateQuantity(item.productId, item.variantId, next);
                            }}
                          />
                        </td>
                        <td className="numeric">{money(item.priceCents * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="cart-totals">
              <h2>Totales del carrito</h2>
              <div className="cart-totals-row">
                <span>Subtotal</span>
                <strong>{money(subtotalCents)}</strong>
              </div>
              <div className="cart-totals-row total">
                <span>Total</span>
                <strong>{money(subtotalCents)}</strong>
              </div>

              {weeklyPlanAvailable && (
                <p className="cart-plan-banner">
                  <strong>Disponible en plan de pago semanal.</strong> Elige &ldquo;Plan semanal&rdquo; al momento de
                  pagar y paga en semanas, sin intereses.
                </p>
              )}

              <Button href="/checkout" variant="primary" fullWidth>
                Proceder al pago <span aria-hidden>→</span>
              </Button>
              <p className="login-help" style={{ marginTop: 14 }}>
                <Link href="/catalogo">Seguir viendo el catálogo</Link>
              </p>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
