import Link from "next/link";
import { PublicFooter } from "../components/navigation/PublicFooter";
import { PublicHeader } from "../components/navigation/PublicHeader";
import { ProductCard } from "../components/ui/ProductCard";
import { getCatalogProducts } from "../lib/supabase/catalog";
import { readSiteContent } from "../lib/supabase/site-content";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const content = await readSiteContent();
  return { title: { absolute: content.seoTitle }, description: content.seoDescription, alternates: { canonical: content.canonicalOrigin }, openGraph: { title: content.seoTitle, description: content.seoDescription, url: content.canonicalOrigin } };
}
export default async function HomePage() {
  const content = await readSiteContent();
  let featured: Awaited<ReturnType<typeof getCatalogProducts>>["products"] = [];
  try { const { products } = await getCatalogProducts({ sort: "recent" }); featured = products.filter((p) => p.imageUrl).slice(0, 4); } catch { featured = []; }
  const sections = {
    banner: <Link key="banner" className="hero-banner shell" href={content.bannerHref} aria-label={content.bannerAlt}><img src={content.bannerUrl} alt={content.bannerAlt} loading="eager" /></Link>,
    texto: <section key="texto" className="hero-copy shell"><p className="section-label">{content.eyebrow}</p><h1>{content.title}<em>{content.emphasis}</em></h1><p className="hero-description">{content.description}</p><div className="hero-actions"><Link className="button button-primary" href="/catalogo">Ver catálogo <span aria-hidden>→</span></Link><Link className="button button-secondary" href="/como-comprar">Cómo comprar</Link></div></section>,
    destacados: featured.length ? <section key="destacados" className="shell featured-section"><h2>Destacados</h2><div className="product-grid">{featured.map((product) => <ProductCard product={product} key={product.id} />)}</div></section> : null,
  };
  return <><PublicHeader /><main>{content.announcement && <p className="site-announcement shell">{content.announcement}</p>}{content.sections.map((section) => sections[section])}</main><PublicFooter /></>;
}
