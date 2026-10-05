"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { compressPhoto } from "../../admin/compras/compress-photo";
import type { StaffProductRow } from "../../../lib/supabase/staff-inventory";
import {
  DRAFT_PHOTO_TARGET_BYTES,
  EMPTY_VALUES,
  MAX_UNSENT_PHOTOS,
  PhotoDraftQueue,
  brandIndex,
  draftLabel,
  fieldErrors,
  isFinished,
  missingFields,
  nextOp,
  parsePriceCents,
  parseQuantity,
  provisionalProductName,
  summarize,
  type BrandIndex,
  type Draft,
  type DraftField,
  type ExecResult,
  type Op,
  type QueueDeps,
} from "../../../lib/staff-photo-drafts";
import { openDraftStorage, type DraftStorage } from "../../../lib/staff-photo-drafts-db";
import {
  createStaffProductAction,
  editStaffProductAction,
  editStaffVariantAction,
  recordStaffEntryAction,
  updateStaffInventoryFieldAction,
  updateStaffPriceAction,
  type StaffActionState,
} from "../actions";

// "Añadir productos desde fotos". Each photo becomes a hidden product on its
// own (photo + provisional data), then every field she fills in is saved when
// she leaves it. Drafts that have not reached the server yet are kept on this
// device (IndexedDB) and continue after a reload. See lib/staff-photo-drafts.ts.

type Option = { id: string; name: string };
type Action = (state: StaffActionState, data: FormData) => Promise<StaffActionState>;

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const EMPTY: Draft[] = [];

/** One queue per employee for the whole tab: it keeps working if she navigates inside the panel. */
const queues = new Map<string, PhotoDraftQueue>();
let storagePromise: Promise<DraftStorage> | null = null;
const restoredActors = new Set<string>();
/** The mounted screen of each employee (the queue outlives it when she navigates). */
const mounted = new Map<string, { refresh: () => void; onSaved?: (product: StaffProductRow) => void; brands: BrandIndex }>();

function deviceStorage() {
  storagePromise ??= openDraftStorage();
  return storagePromise;
}

function call(action: Action, fields: Record<string, string | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return action({ error: null, success: null }, data);
}

const money = (cents: number) => (cents / 100).toFixed(2);

export function PhotoProducts({ actorId, categories, brands, onSaved }: { actorId: string; categories: Option[]; brands: Option[]; onSaved?: (product: StaffProductRow) => void }) {
  const router = useRouter();
  const brandsIndex = useMemo(() => brandIndex(brands), [brands]);
  useEffect(() => {
    const current = { refresh: () => router.refresh(), onSaved, brands: brandsIndex };
    mounted.set(actorId, current);
    return () => { if (mounted.get(actorId) === current) mounted.delete(actorId); };
  }, [actorId, router, onSaved, brandsIndex]);

  const [queue] = useState(() => {
    const existing = typeof window === "undefined" ? undefined : queues.get(actorId);
    if (existing) return existing;
    const live = { get current() { return mounted.get(actorId) ?? { refresh: () => {}, onSaved: undefined, brands: brandsIndex }; } };
    const deps: QueueDeps = {
      execute: (op, draft) => send(op, draft),
      prepare: (draft) => {
        if (!draft.photo) return Promise.reject(new Error("Falta la foto."));
        return compressPhoto(new File([draft.photo], "foto", { type: draft.photo.type || "image/jpeg" }), DRAFT_PHOTO_TARGET_BYTES);
      },
      save: async (draft) => { await (await deviceStorage()).put(draft); },
      drop: async (id) => { await (await deviceStorage()).remove(id); },
      brands: () => live.current.brands,
      onIdle: (changed) => { if (changed) live.current.refresh(); },
    };
    async function send(op: Op, draft: Draft): Promise<ExecResult> {
      if (op.kind === "create") {
        if (!draft.photo) return { ok: false, error: "Falta la foto." };
        const photo = new File([draft.photo], `foto-${draft.id.slice(0, 8)}.jpg`, { type: draft.photo.type || "image/jpeg" });
        const result = await call(createStaffProductAction, { draft: "1", clientRef: draft.id, name: draft.provisionalName, photo });
        if (!result.productId) return { ok: false, error: result.error ?? "No se pudo guardar el producto." };
        if (result.product) live.current.onSaved?.(result.product);
        return {
          ok: true,
          patch: { productId: result.productId, variantId: result.variantId ?? result.product?.variants[0]?.id ?? null, imageUrl: result.product?.imageUrl ?? null },
          savedName: result.product?.name,
        };
      }
      if (!draft.productId || !draft.variantId) return { ok: false, error: "Recarga la página para terminar de guardar este producto." };
      let result: StaffActionState;
      switch (op.kind) {
        case "product":
          result = await call(editStaffProductAction, { productId: draft.productId, name: op.name, categoryId: op.categoryId ?? "", brandId: op.brandId ?? "" });
          break;
        case "price":
          result = await call(updateStaffPriceAction, { variantId: draft.variantId, price: money(op.priceCents) });
          break;
        case "variant":
          result = await call(editStaffVariantAction, { variantId: draft.variantId, name: op.name, price: money(op.priceCents) });
          break;
        case "entry":
          result = await call(recordStaffEntryAction, { variantId: draft.variantId, quantity: String(op.quantity), note: "Existencia inicial (alta desde fotos)", expectedStock: String(op.expectedStock) });
          break;
        case "stock":
          result = await call(updateStaffInventoryFieldAction, { variantId: draft.variantId, field: "stock", value: String(op.quantity) });
          break;
      }
      return result.error ? { ok: false, error: result.error } : { ok: true };
    }
    const created = new PhotoDraftQueue(deps);
    if (typeof window !== "undefined") queues.set(actorId, created);
    return created;
  });
  const drafts = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY);

  const [storageKind, setStorageKind] = useState<"pending" | DraftStorage["kind"]>("pending");
  const [restored, setRestored] = useState<{ count: number; unsent: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Open the device copy once and bring back what was left unsaved.
  useEffect(() => {
    let cancelled = false;
    void deviceStorage().then(async (storage) => {
      if (cancelled) return;
      setStorageKind(storage.kind);
      if (restoredActors.has(actorId)) return;
      restoredActors.add(actorId);
      try {
        const rows = await storage.list(actorId);
        const count = queue.load(rows);
        if (count) setRestored({ count, unsent: rows.filter((row) => !row.productId).length });
      } catch {
        setNotice("No pudimos leer los borradores guardados en este dispositivo.");
      }
    });
    return () => { cancelled = true; };
  }, [actorId, queue]);

  // Warn before leaving with photos not uploaded or changes not saved; save on hide; resume when online.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      queue.commitAll();
      if (!queue.hasUnsaved()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const hide = () => { if (document.visibilityState === "hidden") { queue.commitAll(); void queue.persistPending(); } };
    const pageHide = () => { queue.commitAll(); void queue.persistPending(); };
    const online = () => queue.flush();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("online", online);
    };
  }, [queue]);

  function addFiles(files: File[]) {
    const errors: string[] = [];
    let unsent = queue.drafts.filter((draft) => !draft.productId).length;
    let seq = queue.drafts.reduce((max, draft) => Math.max(max, draft.seq), 0);
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) { errors.push(`${file.name}: usa JPG, PNG o WebP.`); continue; }
      if (file.size === 0 || file.size > 20 * 1024 * 1024) { errors.push(`${file.name}: la foto debe pesar menos de 20 MB.`); continue; }
      if (unsent >= MAX_UNSENT_PHOTOS) { errors.push(`Hay ${MAX_UNSENT_PHOTOS} fotos esperando subir: agrega más cuando terminen de guardarse.`); break; }
      const photoKey = `${file.name}:${file.size}:${file.lastModified}`;
      if (queue.drafts.some((draft) => draft.photoKey === photoKey)) continue;
      seq += 1;
      unsent += 1;
      const now = Date.now();
      queue.add({
        id: crypto.randomUUID(), actorId, createdAt: now, seq, provisionalName: provisionalProductName(new Date(now), seq),
        photo: file, photoReady: false, photoKey, productId: null, variantId: null, imageUrl: null, values: { ...EMPTY_VALUES }, saved: null,
      });
    }
    setNotice(errors.join(" "));
  }

  // Stable, so unchanged cards are not re-rendered on every keystroke (memo).
  const remove = useCallback((draft: Draft) => {
    const pending = !draft.productId || nextOp(draft, brandsIndex, draft.values) !== null || draft.rt.phase === "error";
    if (pending && !window.confirm(draft.productId
      ? "Este producto tiene cambios sin guardar. ¿Quitarlo de la lista de todos modos? (El producto sigue en el inventario.)"
      : "Esta foto todavía no se guarda en el inventario. ¿Quitarla?")) return;
    if (!queue.remove(draft.id)) setNotice("Espera a que termine de subir esa foto para quitarla.");
  }, [brandsIndex, queue]);

  const summary = summarize(drafts, brandsIndex, queue.busy());
  const finished = drafts.filter((draft) => isFinished(draft, brandsIndex));
  const somethingToSend = summary.unsent > 0 || summary.pendingEdits > 0 || summary.errors.length > 0;

  return <section className="staff-photo-products" aria-labelledby="photo-products-title">
    <h2 id="photo-products-title">Añadir productos desde fotos</h2>
    <p>Arrastra o elige varias fotos: <strong>cada foto se guarda sola</strong> en el inventario como producto oculto. Después completa nombre, precio y cantidad; cada dato se guarda al salir del campo.</p>
    {storageKind === "memory" && <p className="form-message form-error" role="alert">Este navegador no deja guardar copias en el teléfono (¿modo privado?). Las fotos se suben igual, pero no cierres ni recargues la página hasta que digan “Guardado”.</p>}
    {restored && <div className="form-message form-success staff-photo-restored" role="status">
      <span>Recuperamos {restored.count} borrador(es) de la vez anterior{restored.unsent ? `: ${restored.unsent} foto(s) no se habían subido y ya se están guardando` : ""}{restored.count - restored.unsent ? `${restored.unsent ? ";" : ":"} ${restored.count - restored.unsent} ya están en el inventario y les faltan datos o cambios por guardar` : ""}.</span>
      <button type="button" className="staff-link-button" onClick={() => setRestored(null)}>Entendido</button>
    </div>}
    <div className={`staff-photo-drop${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
      <strong>Arrastra tus fotos aquí</strong>
      <span>JPG, PNG o WebP · hasta {MAX_UNSENT_PHOTOS} fotos por subir a la vez</span>
      <button type="button" className="button button-secondary" onClick={() => input.current?.click()}>Seleccionar varias fotos</button>
      <input ref={input} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Fotos para nuevos productos"
        onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
    {notice && <p className="form-message form-error" role="alert">{notice}</p>}

    {drafts.length > 0 && <>
      <div className="staff-photo-summary" role="status" aria-live="polite">
        <p><strong>Guardados en el inventario {summary.saved}</strong> · Faltan datos {summary.missing} · <span className={summary.errors.length ? "staff-photo-summary-error" : undefined}>Con error {summary.errors.length}</span>{summary.unsent ? ` · Fotos por subir ${summary.unsent}` : ""}</p>
        {summary.busy && <p className="staff-hint">Guardando en segundo plano… puedes seguir llenando datos.</p>}
        {summary.errors.length > 0 && <ul className="staff-photo-errors">{summary.errors.map((item) => <li key={item.id}><strong>{item.label}:</strong> {item.error}</li>)}</ul>}
        <div className="staff-photo-save">
          <button type="button" className="button button-primary" disabled={!somethingToSend} onClick={() => queue.flush()}>Guardar todo ahora</button>
          {finished.length > 0 && <button type="button" className="button button-secondary" onClick={() => { for (const draft of finished) queue.remove(draft.id); }}>{finished.length === 1 ? "Quitar de la lista el producto completo" : `Quitar de la lista los ${finished.length} completos`}</button>}
        </div>
      </div>
      <datalist id="staff-brand-options">{brands.map((brand) => <option key={brand.id} value={brand.name} />)}</datalist>
      <div className="staff-photo-drafts">
        {drafts.map((draft) => <DraftCard key={draft.id} draft={draft} queue={queue} categories={categories} brands={brandsIndex} onRemove={remove} />)}
      </div>
    </>}
  </section>;
}

function DraftPhoto({ draft }: { draft: Draft }) {
  // Only the compressed copy (≤1600 px) is previewed: decoding dozens of
  // full-size phone originals at once can exhaust a phone's memory.
  const blob = draft.photoReady ? draft.photo : null;
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const src = url ?? draft.imageUrl;
  if (!src) return <div className="staff-photo-draft-noimage">{draft.photo && !draft.photoReady && draft.rt.phase !== "error" ? "Preparando foto…" : "Sin vista previa"}</div>;
  // Local preview (object URL) or the catalogue image just uploaded.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`Foto del producto ${draft.seq}`} loading="lazy" decoding="async" />;
}

function statusOf(draft: Draft, brands: BrandIndex): { tone: "neutral" | "warning" | "danger" | "success"; text: string; retry?: boolean } {
  const { phase, error } = draft.rt;
  if (!draft.productId) {
    if (phase === "error") return { tone: "danger", text: `No se pudo guardar: ${error}`, retry: true };
    if (phase === "retrying") return { tone: "warning", text: `Reintentando solo… (${error})` };
    if (phase === "uploading") return { tone: "neutral", text: "Subiendo y guardando…" };
    if (phase === "preparing" || !draft.photoReady) return { tone: "neutral", text: "Preparando foto…" };
    return { tone: "neutral", text: "En cola para subir" };
  }
  if (phase === "saving") return { tone: "neutral", text: "Guardando cambios…" };
  if (phase === "retrying") return { tone: "warning", text: `Cambio sin guardar, reintentando solo… (${error})` };
  if (phase === "error") return { tone: "danger", text: `Cambio sin guardar: ${error}`, retry: true };
  if (nextOp(draft, brands, draft.values)) return { tone: "warning", text: "Cambios por guardar (se guardan al salir del campo)" };
  if (missingFields(draft.values).length) return { tone: "warning", text: "Guardado ✓ · faltan datos" };
  return { tone: "success", text: "Completo ✓" };
}

const DraftCard = memo(function DraftCard({ draft, queue, categories, brands, onRemove }: { draft: Draft; queue: PhotoDraftQueue; categories: Option[]; brands: BrandIndex; onRemove: (draft: Draft) => void }) {
  const values = draft.values;
  const errors = fieldErrors(values, brands);
  const shown = (field: DraftField) => (draft.rt.touched[field] ? errors[field] : undefined);
  const missing = missingFields(values);
  const status = statusOf(draft, brands);
  const id = `draft-${draft.id}`;
  const waitingForPrice = Boolean(draft.productId) && (draft.saved?.priceCents ?? 0) <= 0 && parseQuantity(values.quantity) !== null && parsePriceCents(values.price) === null;
  const field = (name: DraftField) => ({
    id: `${id}-${name}`,
    className: "input",
    value: values[name],
    "aria-invalid": Boolean(shown(name)),
    "aria-describedby": shown(name) ? `${id}-${name}-error` : undefined,
    onChange: (event: { target: { value: string } }) => queue.edit(draft.id, name, event.target.value),
    onBlur: () => queue.commit(draft.id),
  });
  const message = (name: DraftField) => shown(name) ? <span className="staff-field-error" id={`${id}-${name}-error`}>{shown(name)}</span> : null;
  const uploading = draft.rt.phase === "uploading" && !draft.productId;

  return <article className="staff-photo-draft" aria-labelledby={`${id}-title`}>
    <DraftPhoto draft={draft} />
    <div className="staff-photo-draft-body">
      <div className="staff-photo-draft-heading">
        <strong id={`${id}-title`}>Producto {draft.seq}{values.name.trim() ? ` · ${draftLabel(draft)}` : ""}</strong>
        <button type="button" className="staff-link-button" disabled={uploading} onClick={() => onRemove(draft)}>{draft.productId ? "Quitar de esta lista" : "Quitar"}</button>
      </div>
      <p className={`staff-photo-status is-${status.tone}`} role={status.tone === "danger" ? "alert" : "status"}>
        <span>{status.text}</span>
        {status.retry && <button type="button" className="button button-secondary button-small" onClick={() => queue.retry(draft.id)}>Reintentar</button>}
      </p>
      {draft.rt.localError && <p className="staff-hint staff-photo-local-error">{draft.rt.localError}</p>}
      <p className="staff-photo-chips">
        {missing.length ? <span className="badge badge-warning">Falta: {missing.join(" · ")}</span> : <span className="badge badge-success">Datos completos</span>}
        {!values.brand.trim() && <span className="badge badge-neutral">marca (opcional)</span>}
      </p>
      <div className="staff-photo-fields">
        <label className="field" htmlFor={`${id}-name`}><span>Nombre</span><input {...field("name")} maxLength={140} placeholder={draft.provisionalName} autoComplete="off" />{message("name")}</label>
        <label className="field" htmlFor={`${id}-brand`}><span>Marca (opcional)</span><input {...field("brand")} list="staff-brand-options" placeholder="Busca una marca…" autoComplete="off" />{message("brand")}</label>
        <label className="field" htmlFor={`${id}-categoryId`}><span>Categoría</span>
          <select id={`${id}-categoryId`} className="input" value={values.categoryId} onChange={(event) => { queue.edit(draft.id, "categoryId", event.target.value); queue.commit(draft.id); }}>
            <option value="">Sin categoría</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-variant`}><span>Variante</span><input {...field("variant")} maxLength={100} autoComplete="off" />{message("variant")}</label>
        <div className="staff-photo-numbers">
          <label className="field" htmlFor={`${id}-price`}><span>Precio de venta</span><input {...field("price")} inputMode="decimal" placeholder="$0.00" autoComplete="off" />{message("price")}</label>
          <label className="field" htmlFor={`${id}-quantity`}><span>Cantidad</span><input {...field("quantity")} inputMode="numeric" placeholder="Ej. 1" autoComplete="off" />{message("quantity")}</label>
        </div>
        {waitingForPrice && <p className="staff-hint">La cantidad se guarda en cuanto el producto tenga precio.</p>}
      </div>
      {draft.productId && <Link className="staff-photo-link" href={`/empleado/inventario/${draft.productId}`}>Ver producto guardado →</Link>}
    </div>
  </article>;
});
