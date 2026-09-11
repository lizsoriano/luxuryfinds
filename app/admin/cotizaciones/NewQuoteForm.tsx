"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input, Select, Textarea } from "../../../components/ui/Fields";
import { formatMoney } from "../../../lib/format";
import { createQuoteAction } from "./actions";

export type QuotableVariant = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  priceCents: number;
  /** Shown as a hint only: a quote never reserves stock. */
  stock: number;
};

type CartLine = { variantId: string; quantity: number };

/**
 * Same picker + cart shape as app/admin/pedidos/NewOrderForm.tsx (.pos-layout /
 * .pos-grid / .pos-card / .pos-cart), with the validity date replacing the
 * payment-mode block: a quote has no payment modality, it has an expiry.
 */
export function NewQuoteForm({
  clients,
  variants,
  defaultValidUntil,
  today,
}: {
  clients: Array<{ id: string; label: string; phone: string }>;
  variants: QuotableVariant[];
  defaultValidUntil: string;
  today: string;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [validUntil, setValidUntil] = useState(defaultValidUntil);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(variants.map((variant) => [variant.variantId, variant])), [variants]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return variants;
    return variants.filter((variant) => `${variant.productName} ${variant.variantName}`.toLowerCase().includes(term));
  }, [variants, query]);

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
    if (!validUntil) return setError("Elige hasta cuándo es válida la cotización.");
    if (validUntil < today) return setError("La vigencia no puede ser una fecha pasada.");

    setPending(true);
    try {
      const result = await createQuoteAction(clientId, cart, validUntil, notes);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push(`/admin/cotizaciones/${result.quoteId}`);
    } catch {
      setError("No fue posible crear la cotización. Intenta de nuevo.");
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
            <h2>¿Para quién es la cotización?</h2>
          </div>
        </div>
        <Select id="quote-client" label="Clienta *" value={clientId} onChange={(event) => setClientId(event.target.value)}>
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
        <label className="field" htmlFor="quote-search">
          <span>Buscar producto</span>
          <input
            id="quote-search"
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
                <small>{variant.stock > 0 ? `${variant.stock} en existencia` : "Por pedido"}</small>
                <span className="pos-card-price">{formatMoney(variant.priceCents)}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aún no tienes productos que cotizar"
            description="Crea tu primer producto para poder armar una cotización desde aquí."
            href="/admin/productos/nuevo"
            action="Crear producto"
          />
        )}
      </Card>

      <Card className="pos-cart">
        <div className="section-heading">
          <div>
            <p className="micro-label">COTIZACIÓN</p>
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
                      <button
                        type="button"
                        aria-label={`Quitar uno de ${variant.productName}`}
                        onClick={() => setQuantity(line.variantId, Math.max(1, line.quantity - 1))}
                      >
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
                      <button
                        type="button"
                        aria-label={`Agregar uno de ${variant.productName}`}
                        onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="admin-hint"
                      style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }}
                      onClick={() => removeLine(line.variantId)}
                    >
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

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <Input
            id="quote-valid-until"
            label="Vigente hasta *"
            type="date"
            min={today}
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
          <Textarea
            id="quote-notes"
            label="Nota para la clienta"
            rows={2}
            maxLength={400}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional. Se incluye en el mensaje que se le envía."
          />
        </div>

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
            {pending ? "Creando…" : "Crear cotización"}
          </Button>
        </div>
        <p className="admin-hint" style={{ marginTop: 10 }}>
          La cotización se crea como borrador: no aparta inventario ni cobra nada. Desde su detalle la envías a la
          clienta y, si acepta, la conviertes en pedido o en venta.
        </p>
      </Card>
    </div>
  );
}
