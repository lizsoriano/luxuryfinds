/**
 * "Añadir productos desde fotos" (panel de empleado): photo-first products that
 * save themselves.
 *
 *  1. Every photo the employee adds is a draft, kept on the device (IndexedDB,
 *     lib/staff-photo-drafts-db.ts) until the server confirms it.
 *  2. A sequential queue compresses it and creates the product right away with
 *     provisional data (name "Producto sin nombre · …", $0, stock 0, hidden).
 *     The draft id travels as `clientRef` and becomes the product id, so a retry
 *     after a lost response can never create the product twice.
 *  3. What she types afterwards (name, brand, category, variant, price,
 *     quantity) is sent field by field with the staff edit actions once she
 *     leaves the field (or stops typing for a few seconds). Every edit is an
 *     absolute "set" (or a guarded first entry), so retrying is safe too.
 *
 * Pure module: no React, no Supabase, no browser APIs (timers are injected), so
 * the queue, the retries and the validation can be tested in Node.
 */

export const DRAFT_PRODUCT_NAME_PREFIX = "Producto sin nombre";
/** Photos waiting to be uploaded at the same time (each one lives in memory/IndexedDB until then). */
export const MAX_UNSENT_PHOTOS = 60;
/** Server actions reject bodies over 1 MB: photos are compressed below this. */
export const DRAFT_PHOTO_TARGET_BYTES = 750 * 1024;
/** Waits between automatic attempts; after the last one the card shows "Reintentar". */
export const DEFAULT_RETRY_DELAYS = [3000, 10000];
/** A field still being typed is sent after this long without keystrokes (or on blur). */
export const DEFAULT_IDLE_COMMIT_MS = 8000;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "Producto sin nombre · 05 oct 01:23 · #3" in La Paz time (UTC−7, no DST since 2022). */
export function provisionalProductName(date: Date, seq?: number) {
  const local = new Date(date.getTime() - 7 * 60 * 60 * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  const stamp = `${two(local.getUTCDate())} ${MONTHS[local.getUTCMonth()]} ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`;
  return `${DRAFT_PRODUCT_NAME_PREFIX} · ${stamp}${seq ? ` · #${seq}` : ""}`;
}

export function isProvisionalName(name: string | null | undefined) {
  return !name || name.trim() === "" || name.trim().startsWith(DRAFT_PRODUCT_NAME_PREFIX);
}

// ---------------------------------------------------------------------------
// Values and validation (same rules as the staff edit actions)
// ---------------------------------------------------------------------------

export type DraftValues = { name: string; categoryId: string; brand: string; variant: string; price: string; quantity: string };
export type DraftField = keyof DraftValues;
/** What the server has, as last confirmed. */
export type SavedValues = { name: string; categoryId: string | null; brandId: string | null; variant: string; priceCents: number; quantity: number };

export const EMPTY_VALUES: DraftValues = { name: "", categoryId: "", brand: "", variant: "Único", price: "", quantity: "" };

/** Lower-cased brand name → brand id (only brands that already exist). */
export type BrandIndex = Map<string, string>;
export function brandIndex(brands: Array<{ id: string; name: string }>): BrandIndex {
  return new Map(brands.map((brand) => [brand.name.trim().toLowerCase(), brand.id]));
}

/** "150", "150.5", "$1,250.00" → cents; null unless > 0 with at most two decimals. */
export function parsePriceCents(text: string): number | null {
  const raw = text.replace(/[\s$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

/** Whole pieces, 1 or more. */
export function parseQuantity(text: string): number | null {
  const raw = text.trim();
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 && value <= 100_000 ? value : null;
}

export function fieldErrors(values: DraftValues, brands: BrandIndex): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  if (values.name.trim().length > 140) errors.name = "Usa hasta 140 caracteres.";
  const brand = values.brand.trim();
  if (brand && brands.size && !brands.has(brand.toLowerCase())) errors.brand = "Elige una marca de la lista (aquí no se crean marcas nuevas).";
  if (!values.variant.trim()) errors.variant = "Escribe la variante (o deja “Único”).";
  else if (values.variant.trim().length > 100) errors.variant = "Usa hasta 100 caracteres.";
  if (values.price.trim() && parsePriceCents(values.price) === null) errors.price = "Escribe un precio mayor a cero, con hasta dos decimales.";
  if (values.quantity.trim() && parseQuantity(values.quantity) === null) errors.quantity = "Escribe una cantidad entera de al menos 1.";
  return errors;
}

export type MissingField = "nombre" | "precio" | "cantidad";
/** What she still has to fill in (the brand is optional and reported apart). */
export function missingFields(values: DraftValues): MissingField[] {
  const missing: MissingField[] = [];
  if (!values.name.trim() || isProvisionalName(values.name)) missing.push("nombre");
  if (parsePriceCents(values.price) === null) missing.push("precio");
  if (parseQuantity(values.quantity) === null) missing.push("cantidad");
  return missing;
}

// ---------------------------------------------------------------------------
// Drafts and operations
// ---------------------------------------------------------------------------

export type StoredDraft = {
  /** uuid generated in the browser; sent as clientRef and used as the product id. */
  id: string;
  actorId: string;
  createdAt: number;
  seq: number;
  provisionalName: string;
  /** The photo until the product exists (original, then the compressed JPEG). */
  photo: Blob | null;
  photoReady: boolean;
  /** name:size:lastModified of the picked file, to ignore the same photo twice. */
  photoKey: string;
  productId: string | null;
  variantId: string | null;
  imageUrl: string | null;
  values: DraftValues;
  saved: SavedValues | null;
};

export type OpKind = "prepare" | "create" | "product" | "price" | "variant" | "entry" | "stock";
export type Op =
  | { kind: "create" }
  | { kind: "product"; name: string; categoryId: string | null; brandId: string | null }
  | { kind: "price"; priceCents: number }
  | { kind: "variant"; name: string; priceCents: number }
  /** First stock of the product: a RECEIPT, refused by the server unless stock is still `expectedStock`. */
  | { kind: "entry"; quantity: number; expectedStock: number }
  /** Later corrections: absolute stock (the server writes the difference). */
  | { kind: "stock"; quantity: number };

export type Phase = "idle" | "preparing" | "uploading" | "saving" | "retrying" | "error";

export type Draft = StoredDraft & {
  rt: {
    phase: Phase;
    error: string | null;
    errorOp: OpKind | null;
    attempts: number;
    retryAt: number | null;
    /** Values already "let go" by the employee (blur / idle); only these are sent. */
    committed: DraftValues;
    touched: Partial<Record<DraftField, boolean>>;
    /** The copy on this device failed (quota, private mode…). */
    localError: string | null;
  };
};

export const SAVED_DEFAULTS = (name: string): SavedValues => ({ name, categoryId: null, brandId: null, variant: "Único", priceCents: 0, quantity: 0 });

/** The next server write this draft needs, from `values` (default: the committed ones). */
export function nextOp(draft: StoredDraft, brands: BrandIndex, values: DraftValues = (draft as Draft).rt?.committed ?? draft.values): Op | null {
  if (!draft.productId || !draft.saved) return draft.photo && draft.photoReady ? { kind: "create" } : null;
  const saved = draft.saved;
  const typedName = values.name.trim();
  const name = typedName && typedName.length <= 140 ? typedName : saved.name;
  const brandText = values.brand.trim();
  const brandId = !brandText ? null : (brands.get(brandText.toLowerCase()) ?? saved.brandId);
  const categoryId = values.categoryId || null;
  if (name !== saved.name || categoryId !== saved.categoryId || brandId !== saved.brandId) return { kind: "product", name, categoryId, brandId };
  const price = parsePriceCents(values.price);
  if (price !== null && price !== saved.priceCents) return { kind: "price", priceCents: price };
  // Nothing gets stock or a variant rename while the price is $0: a $0 product with stock could be sold.
  if (saved.priceCents > 0) {
    const variant = values.variant.trim();
    if (variant && variant.length <= 100 && variant !== saved.variant) return { kind: "variant", name: variant, priceCents: saved.priceCents };
    const quantity = parseQuantity(values.quantity);
    if (quantity !== null && quantity !== saved.quantity) {
      return saved.quantity === 0 ? { kind: "entry", quantity, expectedStock: 0 } : { kind: "stock", quantity };
    }
  }
  return null;
}

export function applyOp(saved: SavedValues | null, op: Op, provisionalName: string): SavedValues {
  const base = saved ?? SAVED_DEFAULTS(provisionalName);
  switch (op.kind) {
    case "create": return SAVED_DEFAULTS(provisionalName);
    case "product": return { ...base, name: op.name, categoryId: op.categoryId, brandId: op.brandId };
    case "price": return { ...base, priceCents: op.priceCents };
    case "variant": return { ...base, variant: op.name };
    case "entry":
    case "stock": return { ...base, quantity: op.quantity };
  }
}

/** Something on this card still has to reach the server (uncommitted typing included). */
export function hasPendingWork(draft: Draft, brands: BrandIndex) {
  if (!draft.productId) return true;
  if (draft.rt.phase === "saving" || draft.rt.phase === "retrying" || draft.rt.phase === "error") return true;
  return nextOp(draft, brands, draft.values) !== null;
}

/** Created, nothing missing, nothing pending: the device copy is no longer needed. */
export function isFinished(draft: Draft, brands: BrandIndex) {
  return Boolean(draft.productId) && !missingFields(draft.values).length && !hasPendingWork(draft, brands);
}

export function draftLabel(draft: StoredDraft) {
  const name = draft.values.name.trim();
  return name && !isProvisionalName(name) ? name : `Producto ${draft.seq}`;
}

export type QueueSummary = {
  total: number;
  saved: number;
  missing: number;
  unsent: number;
  pendingEdits: number;
  errors: Array<{ id: string; label: string; error: string }>;
  busy: boolean;
};

export function summarize(drafts: Draft[], brands: BrandIndex, busy: boolean): QueueSummary {
  const created = drafts.filter((draft) => draft.productId);
  return {
    total: drafts.length,
    saved: created.length,
    missing: created.filter((draft) => missingFields(draft.values).length > 0).length,
    unsent: drafts.length - created.length,
    pendingEdits: created.filter((draft) => hasPendingWork(draft, brands)).length,
    errors: drafts.filter((draft) => draft.rt.phase === "error").map((draft) => ({ id: draft.id, label: draftLabel(draft), error: draft.rt.error ?? "Error desconocido." })),
    busy,
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type ExecResult = { ok: true; patch?: Partial<Pick<StoredDraft, "productId" | "variantId" | "imageUrl">>; savedName?: string } | { ok: false; error: string };

export type QueueDeps = {
  /** Sends one operation (server action). May throw on a network failure. */
  execute: (op: Op, draft: Draft) => Promise<ExecResult>;
  /** Compresses the photo; throws with a message she can read. */
  prepare: (draft: Draft) => Promise<Blob>;
  /** Device copy. May throw (quota…); the queue keeps going in memory. */
  save: (draft: StoredDraft) => Promise<void>;
  drop: (id: string) => Promise<void>;
  brands: () => BrandIndex;
  onSuccess?: (op: Op, draft: Draft) => void;
  /** The network lane went idle; `changed` = something was saved since the last idle. */
  onIdle?: (changed: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  retryDelays?: number[];
  idleCommitMs?: number;
  persistDebounceMs?: number;
};

const NETWORK_ERROR = "Se perdió la conexión con el servidor.";

function toStored(draft: Draft): StoredDraft {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rt, ...stored } = draft;
  // Once the product exists the photo lives in the catalogue bucket.
  return stored.productId ? { ...stored, photo: null } : stored;
}

export class PhotoDraftQueue {
  drafts: Draft[] = [];
  deps: QueueDeps;
  netRunning = false;
  prepRunning = false;
  inflight: string | null = null;
  changedSinceIdle = false;
  wakeTimer: unknown = null;
  commitTimers = new Map<string, unknown>();
  persistTimers = new Map<string, unknown>();
  listeners = new Set<() => void>();
  removed = new Set<string>();

  constructor(deps: QueueDeps) {
    this.deps = deps;
  }

  now() { return this.deps.now ? this.deps.now() : Date.now(); }
  timer(fn: () => void, ms: number) { return this.deps.setTimer ? this.deps.setTimer(fn, ms) : setTimeout(fn, ms); }
  clear(timer: unknown) { if (timer === null || timer === undefined) return; if (this.deps.clearTimer) this.deps.clearTimer(timer); else clearTimeout(timer as ReturnType<typeof setTimeout>); }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.drafts;
  emit() { for (const listener of this.listeners) listener(); }
  /** New snapshot without a draft change (busy/idle flipped). */
  touch() { this.drafts = [...this.drafts]; this.emit(); }

  get(id: string) { return this.drafts.find((draft) => draft.id === id); }
  update(id: string, change: (draft: Draft) => Draft) {
    this.drafts = this.drafts.map((draft) => (draft.id === id ? change(draft) : draft));
    this.emit();
  }
  setRt(id: string, rt: Partial<Draft["rt"]>) { this.update(id, (draft) => ({ ...draft, rt: { ...draft.rt, ...rt } })); }

  static fresh(stored: StoredDraft): Draft {
    return { ...stored, rt: { phase: "idle", error: null, errorOp: null, attempts: 0, retryAt: null, committed: { ...stored.values }, touched: {}, localError: null } };
  }

  /** Drafts restored from the device: whatever she typed counts as finished typing. */
  load(stored: StoredDraft[]) {
    const known = new Set(this.drafts.map((draft) => draft.id));
    const restored = stored.filter((draft) => !known.has(draft.id)).map((draft) => PhotoDraftQueue.fresh(draft));
    this.drafts = [...this.drafts, ...restored].sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
    this.emit();
    this.kick();
    return restored.length;
  }

  add(stored: StoredDraft) {
    this.drafts = [...this.drafts, PhotoDraftQueue.fresh(stored)];
    this.emit();
    void this.persistNow(stored.id);
    this.kick();
  }

  edit(id: string, field: DraftField, value: string) {
    const draft = this.get(id);
    if (!draft) return;
    const reset = draft.rt.phase === "error" && draft.rt.errorOp !== "create" && draft.rt.errorOp !== "prepare";
    this.update(id, (current) => ({
      ...current,
      values: { ...current.values, [field]: value },
      rt: { ...current.rt, touched: { ...current.rt.touched, [field]: true }, ...(reset ? { phase: "idle" as Phase, error: null, errorOp: null, attempts: 0 } : {}) },
    }));
    this.clear(this.commitTimers.get(id));
    this.commitTimers.set(id, this.timer(() => this.commit(id), this.deps.idleCommitMs ?? DEFAULT_IDLE_COMMIT_MS));
    this.schedulePersist(id);
  }

  /** She left the field (or stopped typing): send what is there. */
  commit(id: string) {
    this.clear(this.commitTimers.get(id));
    this.commitTimers.delete(id);
    const draft = this.get(id);
    if (!draft) return;
    this.update(id, (current) => ({ ...current, rt: { ...current.rt, committed: { ...current.values } } }));
    void this.persistNow(id);
    this.kick();
  }

  commitAll() { for (const draft of this.drafts) this.commit(draft.id); }

  retry(id: string) {
    const draft = this.get(id);
    if (!draft || draft.rt.phase === "uploading" || draft.rt.phase === "saving" || draft.rt.phase === "preparing") return;
    this.setRt(id, { phase: "idle", error: null, errorOp: null, attempts: 0, retryAt: null });
    this.kick();
  }

  /** "Guardar todo ahora" / connection back: send everything, retry every error. */
  flush() {
    this.commitAll();
    for (const draft of this.drafts) if (draft.rt.phase === "error" || draft.rt.phase === "retrying") this.retry(draft.id);
    this.kick();
  }

  /** Refused while its product is being created (it would appear anyway). */
  remove(id: string) {
    const draft = this.get(id);
    if (!draft) return true;
    if (this.inflight === id && !draft.productId) return false;
    this.removed.add(id);
    this.clear(this.commitTimers.get(id));
    this.clear(this.persistTimers.get(id));
    this.drafts = this.drafts.filter((row) => row.id !== id);
    this.emit();
    void this.deps.drop(id).catch(() => {});
    return true;
  }

  schedulePersist(id: string) {
    this.clear(this.persistTimers.get(id));
    this.persistTimers.set(id, this.timer(() => void this.persistNow(id), this.deps.persistDebounceMs ?? 400));
  }

  async persistNow(id: string) {
    this.clear(this.persistTimers.get(id));
    this.persistTimers.delete(id);
    const draft = this.get(id);
    if (!draft) return;
    try {
      if (isFinished(draft, this.deps.brands())) await this.deps.drop(id);
      else await this.deps.save(toStored(draft));
      if (draft.rt.localError && this.get(id)) this.setRt(id, { localError: null });
    } catch (error) {
      if (this.get(id)) this.setRt(id, { localError: `No se pudo guardar una copia en este dispositivo (${error instanceof Error ? error.message : "sin espacio"}). Se sube igual: no cierres la página hasta que diga Guardado.` });
    }
  }

  async persistPending() {
    await Promise.all([...this.persistTimers.keys()].map((id) => this.persistNow(id)));
  }

  kick() {
    void this.runPrepare();
    void this.runNetwork();
  }

  async runPrepare() {
    if (this.prepRunning) return;
    this.prepRunning = true;
    try {
      for (;;) {
        const draft = this.drafts.find((row) => !row.productId && row.photo && !row.photoReady && row.rt.phase !== "error" && row.rt.phase !== "preparing");
        if (!draft) break;
        this.setRt(draft.id, { phase: "preparing" });
        try {
          const blob = await this.deps.prepare(draft);
          if (!this.get(draft.id)) continue;
          this.update(draft.id, (current) => ({ ...current, photo: blob, photoReady: true, rt: { ...current.rt, phase: "idle", error: null, errorOp: null } }));
          await this.persistNow(draft.id);
          void this.runNetwork();
        } catch (error) {
          if (this.get(draft.id)) this.setRt(draft.id, { phase: "error", errorOp: "prepare", error: error instanceof Error ? error.message : "No pudimos preparar esa foto." });
        }
      }
    } finally {
      this.prepRunning = false;
      this.touch();
    }
  }

  /** Next draft + operation: pending edits first (they are quick), then uploads in order. */
  pick(): { draft: Draft; op: Op } | null {
    const now = this.now();
    const brands = this.deps.brands();
    let candidate: { draft: Draft; op: Op } | null = null;
    for (const draft of this.drafts) {
      if (draft.rt.phase === "error" || draft.rt.phase === "preparing") continue;
      if (draft.rt.retryAt !== null && draft.rt.retryAt > now) continue;
      const op = nextOp(draft, brands);
      if (!op) continue;
      if (op.kind !== "create") return { draft, op };
      if (!candidate) candidate = { draft, op };
    }
    return candidate;
  }

  async runNetwork() {
    if (this.netRunning) return;
    this.netRunning = true;
    this.clear(this.wakeTimer);
    this.wakeTimer = null;
    try {
      for (;;) {
        const next = this.pick();
        if (!next) break;
        await this.runOne(next.draft, next.op);
      }
    } finally {
      this.netRunning = false;
      this.inflight = null;
    }
    const waiting = this.drafts.map((draft) => draft.rt.retryAt).filter((at): at is number => at !== null);
    if (waiting.length) {
      this.wakeTimer = this.timer(() => { this.wakeTimer = null; void this.runNetwork(); }, Math.max(0, Math.min(...waiting) - this.now()));
    }
    const changed = this.changedSinceIdle;
    this.changedSinceIdle = false;
    this.touch();
    this.deps.onIdle?.(changed);
  }

  async runOne(draft: Draft, op: Op) {
    this.inflight = draft.id;
    this.setRt(draft.id, { phase: op.kind === "create" ? "uploading" : "saving", retryAt: null });
    let result: ExecResult;
    try {
      result = await this.deps.execute(op, this.get(draft.id) ?? draft);
    } catch (error) {
      result = { ok: false, error: error instanceof Error && error.message && !/fetch|network|load failed/i.test(error.message) ? error.message : NETWORK_ERROR };
    }
    this.inflight = null;
    if (this.removed.has(draft.id) && !this.get(draft.id)) return;
    if (result.ok) {
      const patch = result.ok ? result.patch ?? {} : {};
      this.changedSinceIdle = true;
      this.update(draft.id, (current) => ({
        ...current,
        ...patch,
        saved: applyOp(current.saved, op, result.ok && result.savedName ? result.savedName : current.provisionalName),
        rt: { ...current.rt, phase: "idle", error: null, errorOp: null, attempts: 0, retryAt: null },
      }));
      const updated = this.get(draft.id);
      if (updated) this.deps.onSuccess?.(op, updated);
      await this.persistNow(draft.id);
      return;
    }
    const attempts = (this.get(draft.id)?.rt.attempts ?? 0) + 1;
    const delays = this.deps.retryDelays ?? DEFAULT_RETRY_DELAYS;
    if (attempts <= delays.length) {
      this.setRt(draft.id, { phase: "retrying", attempts, error: result.error, errorOp: op.kind, retryAt: this.now() + delays[attempts - 1] });
    } else {
      this.setRt(draft.id, { phase: "error", attempts, error: result.error, errorOp: op.kind, retryAt: null });
    }
  }

  busy() {
    return this.netRunning || this.prepRunning || this.drafts.some((draft) => draft.rt.phase === "retrying");
  }

  summary() { return summarize(this.drafts, this.deps.brands(), this.busy()); }

  /** Anything that would be lost by closing the page now. */
  hasUnsaved() {
    const brands = this.deps.brands();
    return this.drafts.some((draft) => hasPendingWork(draft, brands));
  }

  dispose() {
    this.clear(this.wakeTimer);
    for (const timer of this.commitTimers.values()) this.clear(timer);
    for (const timer of this.persistTimers.values()) this.clear(timer);
    this.listeners.clear();
  }
}
