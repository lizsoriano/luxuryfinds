import { ProductsListPage, type ProductsSearchParams } from "./ProductsListPage";

export const dynamic = "force-dynamic";

/** Productos = the online / por-pedido catalogue (catalog_type ON_DEMAND). */
export default function ProductsPage({ searchParams }: { searchParams: Promise<ProductsSearchParams> }) {
  return <ProductsListPage segment="online" searchParams={searchParams} />;
}
