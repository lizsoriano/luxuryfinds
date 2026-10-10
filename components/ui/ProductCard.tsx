/* eslint-disable @next/next/no-img-element */
"use client";

import type { CatalogProduct } from "../../lib/supabase/catalog";
import { useCart } from "../../lib/cart/CartContext";
import { useFavorites } from "../../lib/favorites/FavoritesContext";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const { addItem } = useCart();
  const { isFavorited, toggleFavorite } = useFavorites();
  const identity = product.slug ?? product.id;
  const favorited = isFavorited(identity);

  return (
    <div className="product-card-plain">
      <button
        type="button"
        className={`product-favorite-btn${favorited ? " is-favorited" : ""}`}
        aria-label={favorited ? "Quitar de favoritos" : "Agregar a favoritos"}
        aria-pressed={favorited}
        onClick={(event) => {
          event.preventDefault();
          toggleFavorite(identity);
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={favorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M12 20.5s-7.5-4.6-10-9.3C.6 8 2 4.5 5.4 3.6c2-.5 4 .2 5.3 1.9l1.3 1.7 1.3-1.7c1.3-1.7 3.3-2.4 5.3-1.9C22 4.5 23.4 8 22 11.2c-2.5 4.7-10 9.3-10 9.3Z" strokeLinejoin="round" />
        </svg>
      </button>
      <a className="product-card-link" href={`/catalogo/${product.id}`}>
        <div className="product-photo">
          {product.isNew ? (
            <span className="product-new-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" />
              </svg>
              <span>New in</span>
            </span>
          ) : null}
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
