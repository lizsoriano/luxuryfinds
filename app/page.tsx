import Link from "next/link";
import { PublicFooter } from "../components/navigation/PublicFooter";
import { PublicHeader } from "../components/navigation/PublicHeader";

export const metadata = {
  title: "Luxury Finds | Belleza, moda y hallazgos especiales",
  description: "Productos especiales, compras por pedido y piezas disponibles para entrega inmediata.",
};

export default function HomePage() {
  return (
    <>
      <PublicHeader />
      <main>

      <section className="hero shell">
        <div className="hero-copy">
          <p className="section-label">TU PRÓXIMO FAVORITO</p>
          <h1>Encuentra algo<em>que te encante.</em></h1>
          <p className="hero-description">Productos especiales de moda y belleza, compras por pedido y piezas listas para entrega inmediata en La Paz.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/catalogo">Ver catálogo <span aria-hidden>→</span></Link>
            <Link className="button button-secondary" href="/como-comprar">Cómo comprar</Link>
          </div>
          <div className="hero-note"><span className="hero-note-mark" aria-hidden>LF</span><p><strong>Elegido para ti</strong><br />Hallazgos especiales con atención personal.</p></div>
        </div>

        <div className="hero-visual" aria-label="Selección de productos Luxury Finds">
          <div className="visual-arch">
            <div className="product-silhouette perfume"><span className="bottle-cap" /><span className="bottle-body">LF<small>EAU DE PARFUM</small></span></div>
            <div className="product-silhouette lipstick"><span className="lipstick-color" /><span className="lipstick-case" /></div>
          </div>
          <div className="floating-card floating-top"><span className="floating-dot" /><span><strong>Nueva colección</strong><small>Hallazgos recién llegados</small></span></div>
          <div className="floating-card floating-bottom"><span className="availability-mark">✓</span><span><strong>Entrega inmediata</strong><small>Listo para ti en La Paz</small></span></div>
          <span className="decorative-star star-one" aria-hidden>✦</span><span className="decorative-star star-two" aria-hidden>✦</span>
        </div>
      </section>
      </main>
      <PublicFooter />
    </>
  );
}
