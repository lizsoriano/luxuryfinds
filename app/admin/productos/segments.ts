import type { ProductSegment } from "../../../lib/supabase/admin-catalog";

/**
 * Copy and routes for the three Inventario lists. One table, one filter bar and
 * one paginator serve all three (ProductsListPage); only this changes.
 */
export type SegmentConfig = {
  segment: ProductSegment;
  path: string;
  title: string;
  description: string;
  /** Preselects the right Disponibilidad in the "Agregar producto" form. */
  newProductHref: string;
  emptyTitle: string;
  emptyDescription: string;
  exportFileName: string;
};

export const SEGMENTS: Record<ProductSegment, SegmentConfig> = {
  online: {
    segment: "online",
    path: "/admin/productos",
    title: "Productos",
    description:
      "Catálogo de pedidos online: lo que se vende por pedido, incluidos los productos que trae la sincronización con las tiendas.",
    newProductHref: "/admin/productos/nuevo?tipo=online",
    emptyTitle: "Aún no hay productos por pedido",
    emptyDescription: "Los productos que trae la sincronización y los que crees como “Por pedido” aparecen aquí.",
    exportFileName: "productos-por-pedido",
  },
  inmediata: {
    segment: "inmediata",
    path: "/admin/productos/entrega-inmediata",
    title: "Productos entrega inmediata",
    description: "Lo que ya tienes en la tienda, listo para entregar. Estos productos los subes tú desde el panel.",
    newProductHref: "/admin/productos/nuevo?tipo=inmediata",
    emptyTitle: "Aún no tienes productos de entrega inmediata",
    emptyDescription:
      "Agrega aquí los artículos que tienes físicamente en la tienda, con su cantidad y precio. Aparecerán en Vender y —si los marcas visibles— en la sección Entrega inmediata del sitio.",
    exportFileName: "productos-entrega-inmediata",
  },
  "en-camino": {
    segment: "en-camino",
    path: "/admin/productos/en-camino",
    title: "Productos en camino",
    description:
      "Mercancía que ya compraste y viene en camino a la tienda. Todavía no se vende; cuando llegue, márcala como recibida y pasa a Entrega inmediata.",
    newProductHref: "/admin/productos/nuevo?tipo=en-camino",
    emptyTitle: "No tienes mercancía en camino",
    emptyDescription:
      "Cuando compres mercancía para la tienda, regístrala aquí con “Viene en camino”. No se podrá vender hasta que la marques como recibida.",
    exportFileName: "productos-en-camino",
  },
};

/** Which list a product belongs to, e.g. for the form's "Volver al listado". */
export function segmentOf(product: { catalog_type: "ON_DEMAND" | "IMMEDIATE"; in_transit?: boolean }): ProductSegment {
  if (product.catalog_type === "ON_DEMAND") return "online";
  return product.in_transit ? "en-camino" : "inmediata";
}
