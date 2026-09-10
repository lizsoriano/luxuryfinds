"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { IconAction } from "../../../components/admin/IconAction";
import { formatMoney, formatQuantity } from "../../../lib/format";
import { bulkArchiveProductsAction, duplicateProductAction, setProductActiveAction } from "./actions";
import type { ProductListRow } from "../../../lib/supabase/admin-catalog";

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

export function ProductsTable({ products }: { products: ProductListRow[] }) {
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
      <div className="admin-table-scroll">
        <table className="admin-data-table">
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
              <th className="numeric">Stock</th>
              <th className="numeric">Precio</th>
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
                <td style={{ color: "var(--admin-muted)" }}>{product.categoryName ?? "—"}</td>
                <td>
                  <Badge tone="neutral">
                    {product.product_kind === "VARIANTS" ? "Variantes" : product.product_kind === "MEASURED" ? "Medidas" : "Básico"}
                  </Badge>
                </td>
                <td className="numeric">{formatQuantity(product.stock, product.variants[0]?.unit_label)}</td>
                <td className="numeric">{formatMoney(product.priceCents)}</td>
                <td>
                  {!product.is_active ? (
                    <Badge tone="neutral">Archivado</Badge>
                  ) : product.is_public ? (
                    <Badge tone="success">Visible</Badge>
                  ) : (
                    <Badge tone="warning">Oculto</Badge>
                  )}
                </td>
                <td>
                  <div className="admin-row-actions">
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
