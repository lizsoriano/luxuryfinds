import { notFound } from "next/navigation";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { getCatalogProductBySlug } from "../../../../lib/supabase/catalog";
import { AddToCartForm } from "./AddToCartForm";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getCatalogProductBySlug(slug).catch(() => null);
  if (!product) notFound();

  const immediate = product.availability === "Entrega inmediata";
  const prices = product.variants.map((v) => v.priceCents);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);
  const priceLabel = minPrice === maxPrice ? money(minPrice) : `${money(minPrice)} – ${money(maxPrice)}`;

  return <main className="catalog-page">
    <div className="shell">
      <p className="catalog-breadcrumb"><a href="/">Inicio</a> <span aria-hidden>.</span> <a href="/catalogo">Catálogo</a> <span aria-hidden>.</span> {product.name}</p>

      <div className="product-detail">
        <div className="product-detail-gallery">
          {product.images.length ? (
            <div className="product-detail-photo"><img src={product.images[0]} alt={product.name} /></div>
          ) : (
            <div className="product-detail-photo product-photo-fallback"><span>{product.brand}</span></div>
          )}
          {product.images.length > 1 && (
            <div className="product-detail-thumbs">
              {product.images.slice(1).map((src) => (
                <div className="product-detail-thumb" key={src}><img src={src} alt={product.name} /></div>
              ))}
            </div>
          )}
        </div>

        <div className="product-detail-info">
          <p className="micro-label">{product.category} · {product.brand}</p>
          <h1>{product.name}</h1>
          <div className="product-detail-meta">
            <strong>{priceLabel}</strong>
            <Badge tone={immediate ? "success" : "rose"}>{product.availability}</Badge>
          </div>

          {product.variants.length > 1 && (
            <div className="product-detail-variants">
              <h3>Presentaciones</h3>
              <ul>
                {product.variants.map((v) => (
                  <li key={v.id}><span>{v.name}</span><span>{money(v.priceCents)}</span></li>
                ))}
              </ul>
            </div>
          )}

          {product.relevantInformation && <p className="product-detail-highlight">{product.relevantInformation}</p>}
          {product.description && <div className="product-detail-description" dangerouslySetInnerHTML={{ __html: product.description }} />}

          {product.variants.length > 0 ? (
            <AddToCartForm
              slug={product.slug}
              productId={product.slug}
              name={product.name}
              brand={product.brand}
              imageUrl={product.images[0] ?? null}
              variants={product.variants}
            />
          ) : null}

          <Button href="/como-comprar" variant="secondary" fullWidth>¿Cómo comprar esta pieza? <span aria-hidden>→</span></Button>
        </div>
      </div>
    </div>
  </main>;
}
