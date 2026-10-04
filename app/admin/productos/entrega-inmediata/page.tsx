import { ProductsListPage, type ProductsSearchParams } from "../ProductsListPage";

export const dynamic = "force-dynamic";

/** Stock in hand: catalog_type IMMEDIATE and not in transit. */
export default function ImmediateProductsPage({ searchParams }: { searchParams: Promise<ProductsSearchParams> }) {
  return <ProductsListPage segment="inmediata" searchParams={searchParams} />;
}
