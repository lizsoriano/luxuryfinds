"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { compressPhoto } from "../../admin/compras/compress-photo";
import { createStaffProductAction } from "../actions";

type Draft = {
  id: string; file: File; preview: string; name: string; category: string;
  variant: string; price: string; quantity: string; productId?: string;
  message?: string; error?: string; uncertain?: boolean; checked?: boolean;
};
const MAX_PHOTOS = 30;

type DraftField = "name" | "variant" | "price" | "quantity";
function draftErrors(draft: Draft): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  const price = Number(draft.price);
  const quantity = Number(draft.quantity);
  if (!draft.name.trim()) errors.name = "Falta el nombre.";
  else if (draft.name.length > 140) errors.name = "Usa hasta 140 caracteres.";
  if (!draft.variant.trim()) errors.variant = "Falta la variante.";
  else if (draft.variant.length > 100) errors.variant = "Usa hasta 100 caracteres.";
  if (!draft.price.trim()) errors.price = "Falta el precio de venta.";
  else if (!Number.isFinite(price) || price < 0.01 || Math.abs(price * 100 - Math.round(price * 100)) >= 0.000001) errors.price = "Indica un precio mayor a cero, con hasta dos decimales.";
  if (!draft.quantity.trim()) errors.quantity = "Falta la cantidad.";
  else if (!Number.isSafeInteger(quantity) || quantity < 1) errors.quantity = "Indica una cantidad entera de al menos 1.";
  return errors;
}
function isComplete(draft: Draft) { return Object.keys(draftErrors(draft)).length === 0; }

export function PhotoProducts({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [savedMessages, setSavedMessages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const previews = useRef(new Set<string>());

  useEffect(() => () => { for (const url of previews.current) URL.revokeObjectURL(url); }, []);

  function addFiles(files: File[]) {
    if (locked.current) return;
    const errors: string[] = [];
    const additions: Draft[] = [];
    for (const file of files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        errors.push(`${file.name}: usa JPG, PNG o WebP.`); continue;
      }
      if (file.size > 20 * 1024 * 1024 || file.size === 0) {
        errors.push(`${file.name}: la foto debe pesar entre 1 byte y 20 MB.`); continue;
      }
      if (drafts.length + additions.length >= MAX_PHOTOS) {
        errors.push(`Puedes preparar hasta ${MAX_PHOTOS} productos a la vez.`); break;
      }
      if ([...drafts, ...additions].some((draft) => draft.file.name === file.name && draft.file.size === file.size && draft.file.lastModified === file.lastModified)) continue;
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      additions.push({ id: crypto.randomUUID(), file, preview, name: "", category: "", variant: "Único", price: "", quantity: "1" });
    }
    setDrafts((current) => [...current, ...additions]);
    setError(errors.join(" "));
  }

  function update(id: string, values: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...values } : draft));
  }

  function remove(draft: Draft) {
    URL.revokeObjectURL(draft.preview);
    previews.current.delete(draft.preview);
    setDrafts((current) => current.filter((row) => row.id !== draft.id));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    setDrafts((current) => current.map((draft) => draft.uncertain ? draft : { ...draft, checked: true }));
    const pending = drafts.filter((draft) => !draft.productId && !draft.uncertain && isComplete(draft));
    if (!pending.length) { setError("Completa los campos marcados en rojo para guardar un producto."); return; }
    locked.current = true;
    setBusy(true);
    setError("");
    let saved = false;
    try {
      for (const [index, draft] of pending.entries()) {
        setProgress(`Guardando ${index + 1} de ${pending.length}…`);
        update(draft.id, { error: undefined });
        let photo;
        try { photo = await compressPhoto(draft.file, 750 * 1024); }
        catch (cause) { update(draft.id, { error: cause instanceof Error ? cause.message : "No se pudo preparar la foto." }); continue; }
        const data = new FormData();
        data.set("name", draft.name);
        data.set("categoryId", draft.category);
        data.set("variantName", draft.variant);
        data.set("variantPrice", draft.price);
        data.set("variantQuantity", draft.quantity);
        data.set("photo", photo);
        try {
          const result = await createStaffProductAction({ error: null, success: null }, data);
          if (result.productId) {
            saved = true;
            setSavedMessages((current) => [...current, result.success ?? `${draft.name}: producto guardado.`]);
            remove(draft);
          } else update(draft.id, { error: result.error ?? "No se pudo guardar el producto." });
        } catch {
          update(draft.id, { uncertain: true, error: "Se perdió la conexión. Revisa el inventario antes de volver a crear este producto." });
          break;
        }
      }
    } finally {
      setBusy(false);
      locked.current = false;
      setProgress("");
      if (saved) router.refresh();
    }
  }

  const pendingCount = drafts.filter((draft) => !draft.productId && !draft.uncertain && isComplete(draft)).length;
  const incompleteCount = drafts.filter((draft) => !draft.productId && !draft.uncertain && !isComplete(draft)).length;
  return <section className="staff-photo-products" aria-labelledby="photo-products-title">
    <h2 id="photo-products-title">Añadir productos desde fotos</h2>
    <p>Arrastra varias fotos: cada una será un producto. Completa sus datos y guarda.</p>
    <div className={`staff-photo-drop${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
      <strong>Arrastra tus fotos aquí</strong>
      <span>JPG, PNG o WebP · hasta {MAX_PHOTOS} fotos</span>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => input.current?.click()}>Seleccionar varias fotos</button>
      <input ref={input} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Fotos para nuevos productos"
        disabled={busy} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    {savedMessages.length > 0 && <div className="form-message form-success" role="status"><strong>{savedMessages.length} producto(s) guardados en el inventario de abajo.</strong>{savedMessages.map((message, index) => <p key={index}>{message}</p>)}<a href="#staff-saved-products">Ver productos guardados ↓</a></div>}
    {drafts.length > 0 && <form onSubmit={save} noValidate>
      <p className="staff-hint">Se guardan como productos ocultos hasta que la dueña los publique. Las fotos se comprimen automáticamente. Al guardar se registran solo los productos completos; los demás siguen aquí como borradores. Las fichas sin guardar se pierden al salir.</p>
      <div className="staff-photo-drafts">
        {drafts.map((draft, index) => {
          const errors = draft.checked ? draftErrors(draft) : {};
          const validation = (field: DraftField) => ({ "aria-invalid": Boolean(errors[field]), "aria-describedby": errors[field] ? `${draft.id}-${field}-error` : undefined });
          return <article className="staff-photo-draft" key={draft.id}>
          {/* Previews are local object URLs, not remote images. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.preview} alt={`Foto del producto ${index + 1}`} />
          <div className="staff-photo-draft-body">
            <div className="staff-photo-draft-heading"><strong>Producto {index + 1} · {isComplete(draft) ? "Listo para guardar" : "Borrador"}</strong>
              <button type="button" className="staff-link-button" disabled={busy} onClick={() => remove(draft)}>{draft.productId ? "Quitar de esta lista" : "Quitar"}</button></div>
            <fieldset disabled={busy || Boolean(draft.productId) || draft.uncertain} className="staff-photo-fields">
              <label className="field"><span>Nombre *</span><input className="input" {...validation("name")} required maxLength={140} value={draft.name} onChange={(event) => update(draft.id, { name: event.target.value })} />{errors.name && <span className="staff-field-error" id={`${draft.id}-name-error`}>{errors.name}</span>}</label>
              <label className="field"><span>Categoría</span><select className="input" value={draft.category} onChange={(event) => update(draft.id, { category: event.target.value })}><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label className="field"><span>Variante *</span><input className="input" {...validation("variant")} required maxLength={100} value={draft.variant} onChange={(event) => update(draft.id, { variant: event.target.value })} />{errors.variant && <span className="staff-field-error" id={`${draft.id}-variant-error`}>{errors.variant}</span>}</label>
              <div className="staff-photo-numbers">
                <label className="field"><span>Precio de venta *</span><input className="input" type="number" min="0.01" step="0.01" inputMode="decimal" {...validation("price")} required value={draft.price} onChange={(event) => update(draft.id, { price: event.target.value })} />{errors.price && <span className="staff-field-error" id={`${draft.id}-price-error`}>{errors.price}</span>}</label>
                <label className="field"><span>Cantidad *</span><input className="input" type="number" min="1" step="1" inputMode="numeric" {...validation("quantity")} required value={draft.quantity} onChange={(event) => update(draft.id, { quantity: event.target.value })} />{errors.quantity && <span className="staff-field-error" id={`${draft.id}-quantity-error`}>{errors.quantity}</span>}</label>
              </div>
            </fieldset>
            {draft.error && <p className="form-message form-error" role="alert">{draft.error}</p>}
            {draft.productId && <><p className="form-message form-success" role="status">{draft.message}</p><Link href={`/empleado/inventario/${draft.productId}`}>Ver producto guardado →</Link></>}
          </div>
        </article>; })}
      </div>
      <div className="staff-photo-save"><button className="button button-primary" type="submit" disabled={busy || drafts.every((draft) => draft.uncertain)}>{busy ? progress : pendingCount ? `Guardar ${pendingCount} producto(s) completo(s)` : "Guardar productos completos"}</button><span role="status">{pendingCount} listo(s) para guardar · {incompleteCount} borrador(es) por completar</span></div>
    </form>}
  </section>;
}
