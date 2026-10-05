"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { IconAction } from "../../../components/admin/IconAction";
import { formatMoney, formatQuantity } from "../../../lib/format";
import {
  bulkArchiveProductsAction,
  duplicateProductAction,
  markProductReceivedAction,
  setProductActiveAction,
} from "./actions";
import type { ProductListRow, ProductSegment } from "../../../lib/supabase/admin-catalog";
import { InlineVariantField } from "./InlineVariantField";
import { InlineStoreCostField } from "./InlineStoreCostField";
import { PublicToggle } from "./PublicToggle";
import { MISSING_RATE_MESSAGE, STORE_COST_UNAVAILABLE_MESSAGE } from "../../../lib/supabase/store-cost";

const PencilIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" strokeLinecap="round" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 7h16" strokeLinecap="round" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
  </svg>
);
const ReceivedIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 7l9-4 9 4-9 4-9-4Z" strokeLinejoin="round" />
    <path d="M3 7v10l9 4 9-4V7" strokeLinejoin="round" />
    <path d="m8.5 13.5 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const RestoreIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" />
    <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function BulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await bulkArchiveProductsAction(previous, formData);
      if (result.success) onClear();
      return result;
    },
    emptyActionState,
  );

  if (!selected.length) return null;

  return (
    <form action={formAction} className="admin-bulk-bar">
      {selected.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      <span>
        <strong>{selected.length}</strong> seleccionado(s)
      </span>
      {state.error && (
        <span className="admin-icon-form-error" role="alert">
          {state.error}
        </span>
      )}
      <span className="admin-bulk-bar-actions">
        <button type="button" className="button button-secondary button-small" onClick={onClear}>
          Cancelar
        </button>
        <button type="submit" className="button button-danger button-small" disabled={pending}>
          {pending ? "Archivando…" : "Archivar seleccionados"}
        </button>
      </span>
    </form>
  );
}

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

export function ProductsTable({
  products,
  segment,
  storeCost = { available: false, hasRate: false },
}: {
  products: ProductListRow[];
  segment?: ProductSegment;
  storeCost?: StoreCostContext;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  }

  return (
    <>
      <BulkBar selected={[...selected]} onClear={() => setSelected(new Set())} />
      <label className="inventory-mobile-select"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!products.length} /> Seleccionar todos los productos</label>
      <div className="admin-table-scroll">
        <table className="admin-data-table admin-products-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos"
                  checked={allSelected}
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
              <tr key={product.id} className={selected.has(product.id) ? "admin-row-selected" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${product.name}`}
                    checked={selected.has(product.id)}
                    onChange={() => toggle(product.id)}
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
