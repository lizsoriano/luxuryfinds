"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "../../../lib/actions";
import { InlineVariantField } from "../../admin/productos/InlineVariantField";
import { IconAction } from "../../../components/admin/IconAction";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { EditProductForm, EditVariantForm } from "./InventoryForms";
import type { StaffProductRow } from "../../../lib/supabase/staff-inventory";
import { archiveStaffProductsAction, duplicateStaffProductAction, updateStaffInventoryFieldAction } from "../actions";

function Icon({ type }: { type: "edit" | "copy" | "trash" }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    {type === "edit" ? <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></> : type === "copy" ? <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h5" /></> : <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>}
  </svg>;
}

export function InventoryRows({ products, actorId, categories }: { products: StaffProductRow[]; actorId: string; categories: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const editable = products.filter((product) => product.createdByAdminId === actorId && !product.isPublic);
  const selectedIds = editable.filter((product) => selected.has(product.id)).map((product) => product.id);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <div className="staff-inventory-rows">
    {selectedIds.length > 0 && <div className="staff-inventory-bulk"><span>{selectedIds.length} seleccionado(s)</span><ConfirmAction action={async (state, data) => { const result = await archiveStaffProductsAction(state, data); if (result.success) { setSelected(new Set()); router.refresh(); } return result; }} fields={{ ids: selectedIds.join(",") }} triggerLabel="Archivar seleccionados" title="Archivar productos" description="Saldrán de esta lista. Sus existencias e historial se conservan." confirmLabel="Archivar" variant="danger" /><button type="button" className="staff-link-button" onClick={() => setSelected(new Set())}>Quitar selección</button></div>}
    <div className="admin-table-wrap"><table className="admin-table staff-inventory-table">
      <thead><tr><th><input type="checkbox" aria-label="Seleccionar todos los productos editables" disabled={!editable.length} checked={Boolean(editable.length) && selectedIds.length === editable.length} onChange={() => setSelected(selectedIds.length === editable.length ? new Set() : new Set(editable.map((product) => product.id)))} /></th><th>Producto</th><th>Categoría</th><th>Tipo</th><th>Existencia</th><th>Precio de venta</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
      <tbody>{products.map((product) => {
        const canEdit = product.createdByAdminId === actorId && !product.isPublic;
        return <ProductRows key={product.id} product={product} categories={categories} canEdit={canEdit} selected={selected.has(product.id)} onSelect={() => toggle(product.id)} editing={editing === product.id} onEdit={() => setEditing(editing === product.id ? null : product.id)} />;
      })}</tbody>
    </table></div>
  </div>;
}

function ProductRows({ product, categories, canEdit, selected, onSelect, editing, onEdit }: { product: StaffProductRow; categories: Array<{ id: string; name: string }>; canEdit: boolean; selected: boolean; onSelect: () => void; editing: boolean; onEdit: () => void }) {
  const router = useRouter();
  const refreshAfter = (action: (state: ActionState, data: FormData) => Promise<ActionState>) => async (state: ActionState, data: FormData) => {
    const result = await action(state, data);
    if (result.success) router.refresh();
    return result;
  };
  return <>
    <tr className={selected ? "admin-row-selected" : undefined}>
      <td><input type="checkbox" aria-label={`Seleccionar ${product.name}`} disabled={!canEdit} checked={selected} onChange={onSelect} /></td>
      <td><Link className="staff-row-product" href={`/empleado/inventario/${product.id}`}>
        {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <span className="staff-row-photo-empty">LF</span>}
        <span><strong>{product.name}</strong><small>{product.variants.length} variante(s)</small></span>
      </Link></td>
      <td className="staff-row-category">{product.categoryName ?? "—"}</td>
      <td><span className="badge badge-neutral">{product.variants.length > 1 ? "Variantes" : "Básico"}</span></td>
      <td>{product.variants.map((variant) => <div className="staff-row-field" key={variant.id}>{product.variants.length > 1 && <small>{variant.name}</small>}<InlineVariantField variantId={variant.id} field="stock" value={variant.stock} allowsDecimal={product.allowsDecimal} disabled={!canEdit} label={`Existencia de ${product.name}, ${variant.name}`} action={refreshAfter(updateStaffInventoryFieldAction)} /></div>)}</td>
      <td>{product.variants.map((variant) => <div className="staff-row-field" key={variant.id}>{product.variants.length > 1 && <small>{variant.name}</small>}<InlineVariantField variantId={variant.id} field="price" value={variant.priceCents} disabled={!canEdit} label={`Precio de ${product.name}, ${variant.name}`} action={refreshAfter(updateStaffInventoryFieldAction)} /></div>)}</td>
      <td><span className={`badge ${product.isPublic ? "badge-success" : "badge-warning"}`}>{product.isPublic ? "Visible" : "Oculto"}</span></td>
      <td><div className="admin-table-actions">
        {canEdit ? <><button className="admin-icon-btn" type="button" aria-label={`Editar ${product.name}`} title="Editar" onClick={onEdit} aria-expanded={editing}><Icon type="edit" /></button><IconAction action={refreshAfter(duplicateStaffProductAction)} fields={{ id: product.id }} label={`Duplicar ${product.name}`} icon={<Icon type="copy" />} /><ConfirmAction action={refreshAfter(archiveStaffProductsAction)} fields={{ ids: product.id }} triggerLabel={`Archivar ${product.name}`} triggerIcon={<Icon type="trash" />} title="Archivar producto" description={`«${product.name}» saldrá de la lista. Sus existencias e historial se conservan.`} confirmLabel="Archivar" variant="danger" /></> : <Link className="admin-icon-btn" href={`/empleado/inventario/${product.id}`} aria-label={`Ver ${product.name}`} title="Ver producto"><Icon type="edit" /></Link>}
      </div></td>
    </tr>
    {editing && canEdit && <tr><td colSpan={8}><div className="staff-row-editor"><EditProductForm key={`${product.id}-${product.name}-${product.categoryId}`} productId={product.id} name={product.name} categoryId={product.categoryId} categories={categories} />{product.variants.map((variant) => <EditVariantForm key={`${variant.id}-${variant.name}-${variant.priceCents}-${variant.stock}`} variant={variant} allowsDecimal={product.allowsDecimal} />)}<Link href={`/empleado/inventario/${product.id}`}>Fotos e historial →</Link><button type="button" className="staff-link-button" onClick={onEdit}>Cerrar edición</button></div></td></tr>}
  </>;
}

