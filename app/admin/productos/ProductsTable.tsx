"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { IconAction } from "../../../components/admin/IconAction";
import { formatMoney, formatQuantity } from "../../../lib/format";
import { BulkActionBar } from "../../../components/admin/bulk/BulkActionBar";
import { CopyIcon, PencilIcon, ReceivedIcon, RestoreIcon, TrashIcon } from "../../../components/admin/RowIcons";
import { useBulkSelection } from "../../../components/admin/bulk/useBulkSelection";
import type { BulkFilter } from "../../../lib/bulk";
import {
  duplicateProductAction,
  markProductReceivedAction,
  setProductActiveAction,
} from "./actions";
import type { ProductListRow, ProductSegment } from "../../../lib/supabase/admin-catalog";
import { InlineVariantField } from "./InlineVariantField";
import { InlineStoreCostField } from "./InlineStoreCostField";
import { PublicToggle } from "./PublicToggle";
import { MISSING_RATE_MESSAGE, STORE_COST_UNAVAILABLE_MESSAGE } from "../../../lib/supabase/store-cost";

/**
 * Stock and Precio are edited in place for single-variant products (one price,
 * one stock: unambiguous). A product with several variants can have a different
 * price per tone/size, so it shows its total and price range and links to the
 * full form instead.
 */
function StockCell({ product }: { product: ProductListRow }) {
  const [variant] = product.variants;
  if (product.variants.length !== 1) {
    return (
      <span className="admin-inline-readonly">
        {product.variants.length ? formatQuantity(product.stock, product.variants[0]?.unit_label) : "—"}
      </span>
    );
  }
  return (
    <InlineVariantField
      variantId={variant.id}
      field="stock"
      value={variant.stock}
      allowsDecimal={product.product_kind === "MEASURED"}
      unitLabel={variant.unit_label}
      disabled={!product.is_active}
      label={`Cantidad de ${product.name}`}
    />
  );
}

function PriceCell({ product }: { product: ProductListRow }) {
  const [variant] = product.variants;
  if (product.variants.length !== 1) {
    return (
      <span className="admin-inline-readonly">
        {!product.variants.length
          ? "Sin variantes"
          : product.priceCents === product.maxPriceCents
            ? formatMoney(product.priceCents)
            : `${formatMoney(product.priceCents)} – ${formatMoney(product.maxPriceCents)}`}
        {product.variants.length ? (
          <Link href={`/admin/productos/${product.id}`} className="admin-inline-link">
            Editar variantes
          </Link>
        ) : null}
      </span>
    );
  }
  return (
    <InlineVariantField
      variantId={variant.id}
      field="price"
      value={variant.price_cents}
      disabled={!product.is_active}
      label={`Precio de ${product.name}`}
    />
  );
}

/** What the "Costo tienda" cells need to know about the setup (migration 009, exchange rate). */
export type StoreCostContext = {
  /** False until migration 009 adds the store-cost columns. */
  available: boolean;
  /** True once the owner captured the exchange rate (and app_settings could be read). */
  hasRate: boolean;
};

/**
 * Costo tienda: US store cost + commission for single-variant products, same
 * rule as Stock / Precio. Disabled (with the reason) until migration 009 runs
 * and the exchange rate is captured; the server enforces both anyway.
 */
function StoreCostCell({ product, context }: { product: ProductListRow; context: StoreCostContext }) {
  const [variant] = product.variants;
  if (product.variants.length !== 1) {
    // Each variant has its own cost: edited in the full form ("Editar variantes" in Precio).
    return (
      <span className="admin-inline-readonly admin-cell-muted" title={product.variants.length ? "Cada variante tiene su costo: edítalo en el producto." : undefined}>
        —
      </span>
    );
  }
  const reason = !context.available
    ? STORE_COST_UNAVAILABLE_MESSAGE
    : !context.hasRate
      ? MISSING_RATE_MESSAGE
      : !product.is_active
        ? "Restaura el producto para editarlo"
        : undefined;
  return (
    <InlineStoreCostField
      variantId={variant.id}
      usdCents={variant.store_cost_usd_cents}
      commissionPercent={variant.commission_percent}
      costCents={Number(variant.cost_cents ?? 0)}
      disabled={Boolean(reason)}
      disabledReason={reason}
      disabledHint={!context.available ? "Requiere migración 009" : !context.hasRate ? "Define el tipo de cambio" : undefined}
      label={product.name}
    />
  );
}

/** What the bulk bar needs to know about the list it sits on. */
export type BulkListContext = {
  /** sessionStorage key: list path + filters (the selection survives page changes, not filter changes). */
  storageKey: string;
  filter: BulkFilter;
  totalResults: number;
  morePages: boolean;
  categories: Array<{ id: string; name: string }>;
};

export function ProductsTable({
  products,
  segment,
  storeCost = { available: false, hasRate: false },
  bulk,
}: {
  products: ProductListRow[];
  segment?: ProductSegment;
  storeCost?: StoreCostContext;
  bulk: BulkListContext;
}) {
  const visibleIds = useMemo(() => products.map((product) => product.id), [products]);
  const selection = useBulkSelection(bulk.storageKey, visibleIds);
  const allSelected = selection.allVisibleSelected;
  const toggleAll = () => selection.setVisible(!allSelected);

  return (
    <>
      <BulkActionBar
        scope="products"
        selection={selection}
        totalResults={bulk.totalResults}
        morePages={bulk.morePages}
        filter={bulk.filter}
        categories={bulk.categories}
      />
      <label className="inventory-mobile-select">
        <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!products.length} /> Seleccionar todo lo visible ({products.length})
      </label>
      <div className="admin-table-scroll">
        <table className="admin-data-table admin-products-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  aria-label="Seleccionar todo lo visible"
                  title="Seleccionar todo lo visible"
                  checked={allSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = selection.someVisibleSelected;
                  }}
                  onChange={toggleAll}
                />
              </th>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Tipo</th>
              <th className="numeric admin-col-stock">Stock</th>
              <th className="numeric admin-col-price">Precio</th>
              <th className="numeric admin-col-cost">Costo tienda</th>
              <th>Catálogo</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className={selection.has(product.id) ? "admin-row-selected" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${product.name}`}
                    checked={selection.has(product.id)}
                    onChange={() => selection.toggle(product.id)}
                  />
                </td>
                <td>
                  <Link href={`/admin/productos/${product.id}`} className="admin-cell-main admin-cell-link">
                    {product.imageUrl ? (
                      <img className="admin-thumb" src={product.imageUrl} alt="" />
                    ) : (
                      <span className="admin-thumb admin-thumb-fallback" aria-hidden>
                        LF
                      </span>
                    )}
                    <span>
                      <strong>{product.name}</strong>
                      <span className="admin-cell-sub">
                        {product.internal_code ?? product.variants[0]?.sku ?? "Sin código"} · {product.variants.length} variante(s)
                      </span>
                    </span>
                  </Link>
                </td>
                <td data-label="Categoría" style={{ color: "var(--admin-muted)" }}>{product.categoryName ?? "—"}</td>
                <td data-label="Tipo">
                  <Badge tone="neutral">
                    {product.product_kind === "VARIANTS" ? "Variantes" : product.product_kind === "MEASURED" ? "Medidas" : "Básico"}
                  </Badge>
                </td>
                <td data-label="Existencia" className="numeric admin-col-stock">
                  <StockCell product={product} />
                </td>
                <td data-label="Precio de venta" className="numeric admin-col-price">
                  <PriceCell product={product} />
                </td>
                <td data-label="Costo tienda" className="numeric admin-col-cost">
                  <StoreCostCell product={product} context={storeCost} />
                </td>
                <td data-label="Catálogo">
                  {!product.is_active ? (
                    <Badge tone="neutral">Archivado</Badge>
                  ) : (
                    <PublicToggle productId={product.id} productName={product.name} isPublic={product.is_public} />
                  )}
                </td>
                <td>
                  <div className="admin-row-actions">
                    {segment === "en-camino" && product.is_active ? (
                      <ConfirmAction
                        action={markProductReceivedAction}
                        fields={{ id: product.id }}
                        triggerLabel="Marcar como recibido"
                        triggerIcon={<ReceivedIcon />}
                        title="Marcar como recibido"
                        description={`"${product.name}" ya llegó a la tienda: pasa a Productos entrega inmediata y desde ese momento se puede vender (y, si está visible, aparece en el sitio). Revisa que la cantidad sea la que realmente recibiste.`}
                        confirmLabel="Ya lo recibí"
                        variant="primary"
                      />
                    ) : null}
                    <Link href={`/admin/productos/${product.id}`} className="admin-icon-btn" aria-label="Editar" title="Editar">
                      <PencilIcon />
                    </Link>
                    <IconAction
                      action={duplicateProductAction}
                      fields={{ id: product.id }}
                      label="Duplicar"
                      icon={<CopyIcon />}
                    />
                    <ConfirmAction
                      action={setProductActiveAction}
                      fields={{ id: product.id, active: product.is_active ? "false" : "true" }}
                      triggerLabel={product.is_active ? "Archivar" : "Restaurar"}
                      triggerIcon={product.is_active ? <TrashIcon /> : <RestoreIcon />}
                      title={product.is_active ? "Archivar producto" : "Restaurar producto"}
                      description={
                        product.is_active
                          ? `"${product.name}" saldrá del catálogo público y del punto de venta. Su historial de inventario y las ventas ya registradas se conservan.`
                          : `"${product.name}" volverá al inventario. Tendrás que marcarlo de nuevo como visible si quieres publicarlo.`
                      }
                      confirmLabel={product.is_active ? "Archivar" : "Restaurar"}
                      variant={product.is_active ? "danger" : "primary"}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
