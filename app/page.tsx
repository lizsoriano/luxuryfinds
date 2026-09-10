import Link from "next/link";
import { PublicFooter } from "../components/navigation/PublicFooter";
import { PublicHeader } from "../components/navigation/PublicHeader";
import { ProductCard } from "../components/ui/ProductCard";
import { getCatalogProducts } from "../lib/supabase/catalog";

export const metadata = {
  title: "Luxury Finds | Belleza, moda y hallazgos especiales",
  description: "Productos especiales, compras por pedido y piezas disponibles para entrega inmediata.",
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let featured: Awaited<ReturnType<typeof getCatalogProducts>>["products"] = [];

  try {
    const { products } = await getCatalogProducts({ sort: "recent" });
    featured = products.filter((p) => p.imageUrl).slice(0, 4);
  } catch {
    featured = [];
  }

  return (
    <>
      <PublicHeader />
      <main>
        <Link className="hero-banner shell" href="/catalogo" aria-label="Ver catálogo completo">
          <img src="/images/banner-inicio.webp" alt="Luxury Finds" loading="eager" />
        </Link>

        <section className="hero-copy shell">
          <p className="section-label">TU PRÓXIMO FAVORITO</p>
          <h1>Encuentra algo<em>que te encante.</em></h1>
          <p className="hero-description">Productos especiales de moda y belleza, compras por pedido y piezas listas para entrega inmediata en La Paz.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/catalogo">Ver catálogo <span aria-hidden>→</span></Link>
            <Link className="button button-secondary" href="/como-comprar">Cómo comprar</Link>
          </div>
        </section>

        {featured.length > 0 && (
          <section className="shell featured-section">
            <h2>Destacados</h2>
            <div className="product-grid">
              {featured.map((product) => <ProductCard product={product} key={product.id} />)}
            </div>
          </section>
        )}
      </main>
      <PublicFooter />
    </>
  );
}
