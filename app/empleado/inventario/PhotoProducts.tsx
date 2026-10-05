"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { compressPhoto } from "../../admin/compras/compress-photo";
import { createStaffProductAction } from "../actions";

type Draft = {
  id: string; file: File; preview: string; name: string; category: string;
  variant: string; price: string; quantity: string; productId?: string;
  message?: string; error?: string; uncertain?: boolean;
};
const MAX_PHOTOS = 30;

function isComplete(draft: Draft) {
  const price = Number(draft.price);
  const quantity = Number(draft.quantity);
  return Boolean(draft.name.trim() && draft.variant.trim() && draft.price.trim() && draft.quantity.trim())
    && draft.name.length <= 140 && draft.variant.length <= 100
    && Number.isFinite(price) && price >= 0.01
    && Math.abs(price * 100 - Math.round(price * 100)) < 0.000001
    && Number.isSafeInteger(quantity) && quantity >= 1;
}

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
    const pending = drafts.filter((draft) => !draft.productId && !draft.uncertain && isComplete(draft));
    if (!pending.length) return;
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
        {drafts.map((draft, index) => <article className="staff-photo-draft" key={draft.id}>
          {/* Previews are local object URLs, not remote images. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.preview} alt={`Foto del producto ${index + 1}`} />
          <div className="staff-photo-draft-body">
            <div className="staff-photo-draft-heading"><strong>Producto {index + 1} · {isComplete(draft) ? "Listo para guardar" : "Borrador"}</strong>
              <button type="button" className="staff-link-button" disabled={busy} onClick={() => remove(draft)}>{draft.productId ? "Quitar de esta lista" : "Quitar"}</button></div>
            <fieldset disabled={busy || Boolean(draft.productId) || draft.uncertain} className="staff-photo-fields">
              <label className="field"><span>Nombre *</span><input className="input" required maxLength={140} value={draft.name} onChange={(event) => update(draft.id, { name: event.target.value })} /></label>
              <label className="field"><span>Categoría</span><select className="input" value={draft.category} onChange={(event) => update(draft.id, { category: event.target.value })}><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label className="field"><span>Variante *</span><input className="input" required maxLength={100} value={draft.variant} onChange={(event) => update(draft.id, { variant: event.target.value })} /></label>
              <div className="staff-photo-numbers">
                <label className="field"><span>Precio de venta *</span><input className="input" type="number" min="0.01" step="0.01" inputMode="decimal" required value={draft.price} onChange={(event) => update(draft.id, { price: event.target.value })} /></label>
                <label className="field"><span>Cantidad *</span><input className="input" type="number" min="1" step="1" inputMode="numeric" required value={draft.quantity} onChange={(event) => update(draft.id, { quantity: event.target.value })} /></label>
              </div>
            </fieldset>
            {draft.error && <p className="form-message form-error" role="alert">{draft.error}</p>}
            {draft.productId && <><p className="form-message form-success" role="status">{draft.message}</p><Link href={`/empleado/inventario/${draft.productId}`}>Ver producto guardado →</Link></>}
          </div>
        </article>)}
      </div>
      <div className="staff-photo-save"><button className="button button-primary" type="submit" disabled={busy || pendingCount === 0}>{busy ? progress : pendingCount ? `Guardar ${pendingCount} producto(s) completo(s)` : "Completa un producto para guardar"}</button><span role="status">{pendingCount} listo(s) para guardar · {incompleteCount} borrador(es) por completar</span></div>
    </form>}
  </section>;
}
