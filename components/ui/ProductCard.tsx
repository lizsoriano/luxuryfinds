import type { ProductMock } from "../../lib/mock-data";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";

export function ProductCard({ product }: { product: ProductMock }) {
  const immediate = product.availability === "Entrega inmediata";
  return <Card className="product-card">
    <div className={`product-art product-art-${product.tone}`} role="img" aria-label={`Presentación de ${product.name}`}><span className="product-art-object">LF<small>{product.category.split(" · ")[1]}</small></span><span className="product-card-favorite" aria-hidden>♡</span></div>
    <div className="product-card-body"><p className="micro-label">{product.category}</p><h2>{product.name}</h2><p className="product-variant">{product.variant}</p><div className="product-meta"><strong>{new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(product.price)}</strong><Badge tone={immediate ? "success" : "rose"}>{product.availability}</Badge></div><Button href={`/catalogo/${product.id}`} variant="secondary" fullWidth>Ver producto <span aria-hidden>→</span></Button></div>
  </Card>;
}
