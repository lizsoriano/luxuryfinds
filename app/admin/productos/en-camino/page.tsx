import { ProductsListPage, type ProductsSearchParams } from "../ProductsListPage";

export const dynamic = "force-dynamic";

/**
 * The owner's own merchandise on its way to the shop (IMMEDIATE + in_transit).
 * Not to be confused with /admin/en-camino, which tracks clients' pedidos.
 */
export default function InTransitProductsPage({ searchParams }: { searchParams: Promise<ProductsSearchParams> }) {
  return <ProductsListPage segment="en-camino" searchParams={searchParams} />;
}
