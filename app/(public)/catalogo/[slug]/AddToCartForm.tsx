"use client";

import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { useCart } from "../../../../lib/cart/CartContext";

export type AddToCartVariant = { id: string; name: string; priceCents: number };

export function AddToCartForm({
  slug,
  productId,
  name,
  brand,
  imageUrl,
  variants,
}: {
  slug: string;
  productId: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  variants: AddToCartVariant[];
}) {
  const { addItem } = useCart();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const selectedVariant = variants.find((v) => v.id === variantId) ?? variants[0] ?? null;

  return (
    <div className="add-to-cart-form">
      {variants.length > 1 && (
        <label className="field" htmlFor="variant">
          <span>Presentación</span>
          <select
            className="input select"
            id="variant"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="cart-qty" role="group" aria-label="Cantidad">
        <button type="button" aria-label="Restar" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
          −
        </button>
        <span>{quantity}</span>
        <button type="button" aria-label="Sumar" onClick={() => setQuantity((q) => Math.min(20, q + 1))}>
          +
        </button>
      </div>

      <Button
        type="button"
        variant="primary"
        fullWidth
        onClick={() => {
          if (!selectedVariant) return;
          addItem(
            {
              productId,
              variantId: selectedVariant.id,
              slug,
              name,
              brand,
              imageUrl,
              priceCents: selectedVariant.priceCents,
            },
            quantity,
          );
          setAdded(true);
          setTimeout(() => setAdded(false), 2000);
        }}
        disabled={!selectedVariant}
      >
        {added ? "Añadido ✓" : "Añadir al carrito"} <span aria-hidden>→</span>
      </Button>
    </div>
  );
}
