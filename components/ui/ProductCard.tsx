/* eslint-disable @next/next/no-img-element */
"use client";

import type { CatalogProduct } from "../../lib/supabase/catalog";
import { useCart } from "../../lib/cart/CartContext";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const { addItem } = useCart();

  return (
    <div className="product-card-plain">
      <a className="product-card-link" href={`/catalogo/${product.id}`}>
        <div className="product-photo">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} loading="lazy" />
          ) : (
            <span className="product-photo-fallback">{product.brand}</span>
          )}
        </div>
        <p className="product-plain-name">{product.name}</p>
        <p className="product-plain-price">
          {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(
            product.priceCents / 100,
          )}
        </p>
      </a>
      <button
        type="button"
        className="product-plain-add"
        onClick={() =>
          addItem({
            productId: product.id,
            variantId: null,
            slug: product.slug ?? product.id,
            name: product.name,
            brand: product.brand,
            imageUrl: product.imageUrl,
            priceCents: product.priceCents,
          })
        }
      >
        Añadir al carrito
      </button>
    </div>
  );
}
