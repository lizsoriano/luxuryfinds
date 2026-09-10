"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Select } from "../../../components/ui/Fields";
import { formatMoney } from "../../../lib/format";
import { createManualOrderAction } from "./actions";

export type OrderableVariant = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  priceCents: number;
  weeklyPlanEligible: boolean;
};

type CartLine = { variantId: string; quantity: number };

const WEEK_OPTIONS = [4, 6, 8, 10, 12, 16];

export function NewOrderForm({
  clients,
  variants,
}: {
  clients: Array<{ id: string; label: string; phone: string }>;
  variants: OrderableVariant[];
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = useState<"FULL" | "WEEKLY_PLAN">("FULL");
  const [numberOfWeeks, setNumberOfWeeks] = useState(8);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(variants.map((variant) => [variant.variantId, variant])), [variants]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return variants;
    return variants.filter((variant) => `${variant.productName} ${variant.variantName}`.toLowerCase().includes(term));
  }, [variants, query]);

  const weeklyPlanAvailable = cart.length > 0 && cart.every((line) => byId.get(line.variantId)?.weeklyPlanEligible);

  const addToCart = (variantId: string) => {
    setCart((current) => {
      const existing = current.find((line) => line.variantId === variantId);
      if (!existing) return [...current, { variantId, quantity: 1 }];
      return current.map((line) => (line.variantId === variantId ? { ...line, quantity: line.quantity + 1 } : line));
    });
  };

  const setQuantity = (variantId: string, quantity: number) => {
    setCart((current) => current.map((line) => (line.variantId === variantId ? { ...line, quantity } : line)));
  };

  const removeLine = (variantId: string) => {
    setCart((current) => current.filter((line) => line.variantId !== variantId));
  };

  const totalCents = cart.reduce((sum, line) => sum + (byId.get(line.variantId)?.priceCents ?? 0) * line.quantity, 0);

  async function handleSubmit() {
    setError(null);
    if (!clientId) return setError("Elige una clienta.");
    if (!cart.length) return setError("Agrega al menos un artículo.");

    setPending(true);
    try {
      const result = await createManualOrderAction(
        clientId,
        cart,
        weeklyPlanAvailable ? paymentMode : "FULL",
        weeklyPlanAvailable && paymentMode === "WEEKLY_PLAN" ? numberOfWeeks : undefined,
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push(`/admin/pedidos/${result.orderId}`);
    } catch {
      setError("No fue posible crear el pedido. Intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pos-layout">
      <Card className="admin-panel">
        <div className="section-heading">
          <div>
            <p className="micro-label">CLIENTA</p>
            <h2>¿Para quién es el pedido?</h2>
          </div>
        </div>
        <Select
          id="order-client"
          label="Clienta *"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        >
          <option value="">Selecciona una clienta…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.label} · {client.phone}
            </option>
          ))}
        </Select>

        <div className="section-heading" style={{ marginTop: 22 }}>
          <div>
            <p className="micro-label">PRODUCTOS</p>
            <h2>{filtered.length} disponible(s)</h2>
          </div>
        </div>
        <label className="field" htmlFor="order-search">
          <span>Buscar producto</span>
          <input
            id="order-search"
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre o variante…"
          />
        </label>
        {variants.length ? (
          <div className="pos-grid" style={{ marginTop: 14 }}>
            {filtered.map((variant) => (
              <button type="button" className="pos-card" key={variant.variantId} onClick={() => addToCart(variant.variantId)}>
                <strong>{variant.productName}</strong>
                <small>{variant.variantName}</small>
                <span className="pos-card-price">{formatMoney(variant.priceCents)}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aún no tienes productos que ofrecer"
            description="Crea tu primer producto para poder armar un pedido desde aquí."
            href="/admin/productos/nuevo"
            action="Crear producto"
          />
        )}
      </Card>

      <Card className="pos-cart">
        <div className="section-heading">
          <div>
            <p className="micro-label">PEDIDO</p>
            <h2>Artículos</h2>
          </div>
          {cart.length ? (
            <Button type="button" variant="secondary" size="small" onClick={() => setCart([])}>
              Vaciar
            </Button>
          ) : null}
        </div>

        {cart.length ? (
          <div className="pos-cart-list">
            {cart.map((line) => {
              const variant = byId.get(line.variantId);
              if (!variant) return null;
              return (
                <div className="pos-cart-item" key={line.variantId}>
                  <div>
                    <strong>{variant.productName}</strong>
                    <small>
                      {variant.variantName} · {formatMoney(variant.priceCents)}
                    </small>
                    <small>Subtotal: {formatMoney(variant.priceCents * line.quantity)}</small>
                  </div>
                  <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                    <div className="pos-qty">
                      <button type="button" aria-label={`Quitar uno de ${variant.productName}`} onClick={() => setQuantity(line.variantId, Math.max(1, line.quantity - 1))}>
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        aria-label={`Cantidad de ${variant.productName}`}
                        onChange={(event) => {
                          const next = Math.round(Number(event.target.value));
                          if (Number.isFinite(next) && next > 0) setQuantity(line.variantId, next);
                        }}
                      />
                      <button type="button" aria-label={`Agregar uno de ${variant.productName}`} onClick={() => setQuantity(line.variantId, line.quantity + 1)}>
                        +
                      </button>
                    </div>
                    <button type="button" className="admin-hint" style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => removeLine(line.variantId)}>
                      Quitar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="admin-hint">Agrega productos desde la izquierda.</p>
        )}

        {weeklyPlanAvailable && (
          <div style={{ marginTop: 14 }}>
            <div className="filter-tabs" role="radiogroup" aria-label="Modalidad de pago">
              <button type="button" role="radio" aria-checked={paymentMode === "FULL"} className={paymentMode === "FULL" ? "active" : ""} onClick={() => setPaymentMode("FULL")}>
                Pago completo
              </button>
              <button type="button" role="radio" aria-checked={paymentMode === "WEEKLY_PLAN"} className={paymentMode === "WEEKLY_PLAN" ? "active" : ""} onClick={() => setPaymentMode("WEEKLY_PLAN")}>
                Plan semanal
              </button>
            </div>
            {paymentMode === "WEEKLY_PLAN" && (
              <Select id="order-weeks" label="Número de semanas" value={numberOfWeeks} onChange={(event) => setNumberOfWeeks(Number(event.target.value))}>
                {WEEK_OPTIONS.map((weeks) => (
                  <option key={weeks} value={weeks}>
                    {weeks} semanas
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}

        <div className="pos-total">
          <span>Total</span>
          <strong>{formatMoney(totalCents)}</strong>
        </div>

        {error && (
          <p className="form-message form-error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: 14 }}>
          <Button type="button" fullWidth disabled={pending} onClick={handleSubmit}>
            {pending ? "Creando…" : "Crear pedido"}
          </Button>
        </div>
        <p className="admin-hint" style={{ marginTop: 10 }}>
          El pedido se crea como borrador. Confírmalo desde su detalle para generar los tickets y descontar
          inventario.
        </p>
      </Card>
    </div>
  );
}
