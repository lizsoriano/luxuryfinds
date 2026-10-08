"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BulkActionBar } from "../../../components/admin/bulk/BulkActionBar";
import { useBulkSelection } from "../../../components/admin/bulk/useBulkSelection";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { PencilIcon, RestoreIcon, StockIcon, TrashIcon } from "../../../components/admin/RowIcons";
import { Badge } from "../../../components/ui/Badge";
import type { BulkFilter } from "../../../lib/bulk";
import { formatMoney, formatQuantity } from "../../../lib/format";
import { setProductActiveAction } from "../productos/actions";
import { InventoryMovementDialog } from "./InventoryMovementDialog";

export type InventoryRow = {
  productId: string;
  productName: string;
  imageUrl: string | null;
  categoryName: string | null;
  isActive: boolean;
  isPublic: boolean;
  variantId: string;
  variantName: string;
  sku: string | null;
  unitLabel: string | null;
  available: number;
  minimum: number;
  priceCents: number;
  costCents: number;
};

/**
 * Inventario: one row per variant (stock, cost and SKU live there). Selection
 * for the bulk actions is per row; price changes apply to the selected
 * variants, product-level actions (ocultar, archivar, categoría…) to their
 * products. Row actions are icon buttons so the table fits without scrolling
 * sideways on a laptop; on phones each row becomes a card.
 */
export function InventoryTable({
  rows,
  storageKey,
  filter,
  totalResults,
  morePages,
  categories,
}: {
  rows: InventoryRow[];
  storageKey: string;
  filter: BulkFilter;
  totalResults: number;
  morePages: boolean;
  categories: Array<{ id: string; name: string }>;
}) {
  const visibleIds = useMemo(() => rows.map((row) => row.variantId), [rows]);
  const selection = useBulkSelection(storageKey, visibleIds);
  const toggleAll = () => selection.setVisible(!selection.allVisibleSelected);

  return (
    <>
      <BulkActionBar
        scope="variants"
        selection={selection}
        totalResults={totalResults}
        morePages={morePages}
        filter={filter}
        categories={categories}
      />
      <label className="inventory-mobile-select">
        <input type="checkbox" checked={selection.allVisibleSelected} onChange={toggleAll} disabled={!rows.length} /> Seleccionar todo lo
        visible ({rows.length})
      </label>
      <div className="admin-table-scroll">
        <table className="admin-data-table admin-products-table inventory-table">
          <thead>
            <tr>
              <th className="inventory-col-check">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todo lo visible"
                  title="Seleccionar todo lo visible"
                  checked={selection.allVisibleSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = selection.someVisibleSelected;
                  }}
                  onChange={toggleAll}
                />
              </th>
              <th>Producto</th>
              <th>Categoría</th>
              <th className="numeric">Stock</th>
              <th className="numeric">Mínimo</th>
              <th className="numeric">Precio</th>
              <th className="numeric">Costo</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOut = row.available <= 0;
              const isLow = !isOut && row.minimum > 0 && row.available <= row.minimum;
              return (
                <tr key={row.variantId} className={selection.has(row.variantId) ? "admin-row-selected" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${row.productName} · ${row.variantName}`}
                      checked={selection.has(row.variantId)}
                      onChange={() => selection.toggle(row.variantId)}
                    />
                  </td>
                  <td>
                    <div className="admin-cell-main">
                      {row.imageUrl ? (
                        <img className="admin-thumb" src={row.imageUrl} alt="" />
                      ) : (
                        <span className="admin-thumb admin-thumb-fallback" aria-hidden>
                          LF
                        </span>
                      )}
                      <span>
                        <strong>{row.productName}</strong>
                        <span className="admin-cell-sub">
                          {row.variantName}
                          {row.sku ? ` · SKU ${row.sku}` : ""}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td data-label="Categoría" className="admin-cell-muted">
                    {row.categoryName ?? "—"}
                  </td>
                  <td data-label="Stock" className="numeric">
                    {formatQuantity(row.available, row.unitLabel)}
                  </td>
                  <td data-label="Mínimo" className="numeric">
                    {row.minimum ? formatQuantity(row.minimum, row.unitLabel) : "—"}
                  </td>
                  <td data-label="Precio" className="numeric">
                    {formatMoney(row.priceCents)}
                  </td>
                  <td data-label="Costo" className="numeric">
                    {formatMoney(row.costCents)}
                  </td>
                  <td data-label="Estado">
                    <span className="inventory-badges">
                      {isOut ? (
                        <Badge tone="danger">Sin stock</Badge>
                      ) : isLow ? (
                        <Badge tone="warning">Stock bajo</Badge>
                      ) : (
                        <Badge tone="success">Disponible</Badge>
                      )}
                      {!row.isActive ? (
                        <Badge tone="neutral">Archivado</Badge>
                      ) : row.isPublic ? (
                        <Badge tone="success">Visible</Badge>
                      ) : (
                        <Badge tone="neutral">Oculto</Badge>
                      )}
                    </span>
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      <Link href={`/admin/productos/${row.productId}`} className="admin-icon-btn" aria-label="Editar" title="Editar">
                        <PencilIcon />
                      </Link>
                      <InventoryMovementDialog
                        variantId={row.variantId}
                        productName={row.productName}
                        variantName={row.variantName}
                        unitLabel={row.unitLabel}
                        triggerIcon={<StockIcon />}
                      />
                      <ConfirmAction
                        action={setProductActiveAction}
                        fields={{ id: row.productId, active: row.isActive ? "false" : "true" }}
                        triggerLabel={row.isActive ? "Archivar" : "Restaurar"}
                        triggerIcon={row.isActive ? <TrashIcon /> : <RestoreIcon />}
                        title={row.isActive ? "Archivar producto" : "Restaurar producto"}
                        description={
                          row.isActive
                            ? `"${row.productName}" saldrá del punto de venta y del catálogo público. El historial de movimientos se conserva.`
                            : `"${row.productName}" volverá al inventario activo.`
                        }
                        confirmLabel={row.isActive ? "Archivar" : "Restaurar"}
                        variant={row.isActive ? "danger" : "primary"}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
