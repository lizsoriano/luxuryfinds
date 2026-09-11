import { EmptyState } from "../../../components/ui/EmptyState";
import { ProductCard } from "../../../components/ui/ProductCard";
import { SectionLabel } from "../../../components/ui/SectionLabel";
import { requireAuthenticatedUser } from "../../../lib/supabase/auth";
import { getProductsByIds, type CatalogProduct } from "../../../lib/supabase/catalog";

export const dynamic = "force-dynamic";

function identityOf(row: { id: string; slug: string | null }) {
  return row.slug ?? row.id;
}

export default async function FavoritesPage() {
  const { supabase, user } = await requireAuthenticatedUser("/favoritos");

  const { data, error } = await supabase
    .schema("luxury_finds")
    .from("favorites")
    .select("products(id, slug)")
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`No fue posible cargar tus favoritos: ${error.message}`);

  const identities = (data ?? []).flatMap((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return product ? [identityOf(product)] : [];
  });

  let products: CatalogProduct[] = [];
  try {
    products = await getProductsByIds(identities);
  } catch {
    products = [];
  }

  return (
    <main className="shell simple-page">
      <SectionLabel>TU LISTA</SectionLabel>
      <h1>Favoritos</h1>
      {products.length ? (
        <div className="product-grid">
          {products.map((product) => (
            <ProductCard product={product} key={product.id} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Aún no tienes favoritos"
          description="Toca el corazón en cualquier producto del catálogo para guardarlo aquí."
          href="/catalogo"
          action="Ver catálogo"
        />
      )}
    </main>
  );
}
