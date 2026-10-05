import { describeError } from "../actions";
import { slugify } from "../format";
import { DRAFT_PRODUCT_NAME_PREFIX, provisionalProductName } from "../staff-photo-drafts";
import {
  ensureUniqueSlug,
  getStockFor,
  productImageUrl,
  recordManualMovement,
  updateVariantQuick,
} from "./admin-catalog";
import {
  EXPENSE_RECEIPT_BUCKET,
  MAX_PRODUCT_IMAGES,
  PRODUCT_IMAGE_BUCKET,
  adminDb,
  adminStorage,
  logActivity,
} from "./business";
import { isMissingInTransitColumn } from "./in-transit";
import { STAFF_DELIVERIES_MIGRATION_FILE, STAFF_SELECTS, isMissingStaffDeliverySchema } from "./staff-schema";

// ---------------------------------------------------------------------------
// Inventario en La Paz, for the staff panel (/empleado/inventario).
//
// "En La Paz" = catalog_type IMMEDIATE and not in transit (same rule as the
// owner's "Productos entrega inmediata" list, lib/supabase/admin-catalog.ts).
// Every read uses STAFF_SELECTS (sale price only — never a cost or commission).
// Every function takes the acting admin id explicitly, so it can be exercised
// from a script without a session; the server actions only check the session.
// ---------------------------------------------------------------------------

export const STAFF_PAGE_SIZE = 20;

/** Phone photos are compressed in the browser (~1600 px JPEG ≤ ~850 KB); a server action body is capped at 1 MB. */
export const MAX_STAFF_PHOTO_BYTES = 1024 * 1024;

const PHOTO_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const STOCK_ENTRY_PHOTO_PREFIX = "stock-entries";

export type StaffVariant = {
  id: string;
  name: string;
  priceCents: number;
  unitLabel: string | null;
  stock: number;
};

export type StaffProductRow = {
  id: string;
  name: string;
  categoryName: string | null;
  categoryId: string | null;
  imageUrl: string | null;
  isPublic: boolean;
  allowsDecimal: boolean;
  createdByAdminId: string | null;
  variants: StaffVariant[];
  stock: number;
  priceCents: number;
  maxPriceCents: number;
};

type ProductRowRaw = {
  id: string;
  name: string;
  category_id: string | null;
  is_public: boolean;
  is_active: boolean;
  catalog_type: "ON_DEMAND" | "IMMEDIATE";
  product_kind: "SIMPLE" | "VARIANTS" | "MEASURED" | null;
  created_by_admin_id: string | null;
  created_at: string;
  categories: unknown;
  product_variants: Array<{ id: string; name: string; price_cents: number; unit_label: string | null; is_active: boolean }> | null;
  product_images: Array<{ storage_key: string; sort_order: number }> | null;
};

function relationName(value: unknown): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return (row as { name?: string } | undefined)?.name ?? null;
}

function toStaffProduct(row: ProductRowRaw, stock: Map<string, number>): StaffProductRow {
  const variants = (row.product_variants ?? [])
    .filter((variant) => variant.is_active)
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((variant) => ({
      id: variant.id,
      name: variant.name,
      priceCents: Number(variant.price_cents ?? 0),
      unitLabel: variant.unit_label,
      stock: stock.get(variant.id) ?? 0,
    }));
  const prices = variants.map((variant) => variant.priceCents);
  const image = [...(row.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
  return {
    id: row.id,
    name: row.name,
    categoryName: relationName(row.categories),
    categoryId: row.category_id,
    imageUrl: productImageUrl(image?.storage_key),
    isPublic: Boolean(row.is_public),
    allowsDecimal: (row.product_kind ?? "SIMPLE") === "MEASURED",
    createdByAdminId: row.created_by_admin_id,
    variants,
    stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
    priceCents: prices.length ? Math.min(...prices) : 0,
    maxPriceCents: prices.length ? Math.max(...prices) : 0,
  };
}

/** Builds the "en La Paz" products query; `filterInTransit` false = migration 008 missing. */
function laPazQuery(filterInTransit: boolean) {
  let builder = adminDb()
    .from("products")
    .select(STAFF_SELECTS.products, { count: "exact" })
    .eq("catalog_type", "IMMEDIATE")
    .eq("is_active", true);
  if (filterInTransit) builder = builder.eq("in_transit", false);
  return builder;
}

export async function listLaPazProducts(query: { search?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = query.pageSize ?? STAFF_PAGE_SIZE;
  const page = Math.max(1, query.page ?? 1);
  const from = (page - 1) * pageSize;
  const search = (query.search ?? "").trim().slice(0, 80);

  const run = (filterInTransit: boolean) => {
    let builder = laPazQuery(filterInTransit);
    if (search) builder = builder.ilike("name", `%${search}%`);
    return builder.order("created_at", { ascending: false }).order("id").range(from, from + pageSize - 1);
  };
  let result = await run(true);
  if (result.error && isMissingInTransitColumn(result.error.message)) result = await run(false);
  if (result.error) throw new Error(result.error.message);

  const rows = (result.data ?? []) as unknown as ProductRowRaw[];
  const stock = await getStockFor(rows.flatMap((row) => (row.product_variants ?? []).map((variant) => variant.id)));
  const total = result.count ?? rows.length;
  return {
    products: rows.map((row) => toStaffProduct(row, stock)),
    page,
    pageSize,
    total,
    hasNextPage: total > from + pageSize,
  };
}

/** Read back a creation with the staff-safe projection, including its actual image and stock. */
export async function readCreatedStaffProduct(productId: string, adminId: string): Promise<StaffProductRow | undefined> {
  const { data, error } = await laPazQuery(true).eq("id", productId).eq("created_by_admin_id", adminId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;
  const row = data as unknown as ProductRowRaw;
  const stock = await getStockFor((row.product_variants ?? []).map((variant) => variant.id));
  return toStaffProduct(row, stock);
}

export type StaffMovement = {
  id: string;
  variantId: string;
  variantName: string;
  type: string;
  quantity: number;
  reason: string | null;
  createdAt: string;
  byName: string;
  evidenceUrl: string | null;
};

export type StaffProductDetail = StaffProductRow & {
  isLaPaz: boolean;
  /** The employee may correct sale prices of what they created, until the owner publishes it. */
  canEditPrices: boolean;
  imageCount: number;
  images: string[];
  movements: StaffMovement[];
  /** False until migration 013: entry photos are not stored yet. */
  evidenceAvailable: boolean;
};

async function staffNames(ids: string[]) {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return names;
  const { data } = await adminDb().from("admin_users").select(STAFF_SELECTS.staffNames).in("id", unique);
  for (const row of (data ?? []) as Array<{ id: string; display_name: string }>) names.set(row.id, row.display_name);
  return names;
}

async function signedReceiptUrls(keys: string[]) {
  const urls = new Map<string, string>();
  if (!keys.length) return urls;
  const { data } = await adminStorage().from(EXPENSE_RECEIPT_BUCKET).createSignedUrls(keys, 300);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

export async function getStaffProduct(productId: string, actorId: string): Promise<StaffProductDetail | null> {
  const db = adminDb();
  const { data, error } = await db.from("products").select(STAFF_SELECTS.products).eq("id", productId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as ProductRowRaw;
  if (row.catalog_type !== "IMMEDIATE" || !row.is_active) return null;

  // In transit products are not "en La Paz" (migration 008). Without the
  // column nothing can be in transit.
  let inTransit = false;
  const transit = await db.from("products").select(STAFF_SELECTS.transit).eq("id", productId).maybeSingle();
  if (!transit.error) inTransit = Boolean((transit.data as { in_transit?: boolean } | null)?.in_transit);

  const variantIds = (row.product_variants ?? []).map((variant) => variant.id);
  const stock = await getStockFor(variantIds);
  const product = toStaffProduct(row, stock);

  let evidenceAvailable = true;
  let movementRows: Array<Record<string, unknown>> = [];
  if (variantIds.length) {
    const withEvidence = await db
      .from("inventory_movements")
      .select(STAFF_SELECTS.movementsWithEvidence)
      .in("variant_id", variantIds)
      .order("created_at", { ascending: false })
      .limit(30);
    if (withEvidence.error && isMissingStaffDeliverySchema(withEvidence.error.message)) {
      evidenceAvailable = false;
      const legacy = await db
        .from("inventory_movements")
        .select(STAFF_SELECTS.movements)
        .in("variant_id", variantIds)
        .order("created_at", { ascending: false })
        .limit(30);
      if (legacy.error) throw new Error(legacy.error.message);
      movementRows = (legacy.data ?? []) as unknown as Array<Record<string, unknown>>;
    } else if (withEvidence.error) {
      throw new Error(withEvidence.error.message);
    } else {
      movementRows = (withEvidence.data ?? []) as unknown as Array<Record<string, unknown>>;
    }
  }

  const names = await staffNames(movementRows.map((movement) => String(movement.created_by_admin_id ?? "")));
  const evidenceKeys = movementRows.map((movement) => movement.evidence_storage_key).filter((key): key is string => typeof key === "string" && Boolean(key));
  const urls = await signedReceiptUrls(evidenceKeys);
  const variantNames = new Map((row.product_variants ?? []).map((variant) => [variant.id, variant.name]));
  const images = [...(row.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => productImageUrl(image.storage_key))
    .filter((url): url is string => Boolean(url));

  return {
    ...product,
    isLaPaz: !inTransit,
    canEditPrices: row.created_by_admin_id === actorId && !row.is_public,
    imageCount: (row.product_images ?? []).length,
    images,
    evidenceAvailable,
    movements: movementRows.map((movement) => {
      const by = String(movement.created_by_admin_id ?? "");
      const key = typeof movement.evidence_storage_key === "string" ? movement.evidence_storage_key : null;
      return {
        id: String(movement.id),
        variantId: String(movement.variant_id),
        variantName: variantNames.get(String(movement.variant_id)) ?? "Variante",
        type: String(movement.movement_type),
        quantity: Number(movement.quantity_delta ?? 0),
        reason: (movement.reason as string | null) ?? null,
        createdAt: String(movement.created_at),
        byName: by ? (names.get(by) ?? "Usuario eliminado") : "Sistema",
        evidenceUrl: key ? (urls.get(key) ?? null) : null,
      };
    }),
  };
}

export async function listStaffCategories() {
  const { data, error } = await adminDb()
    .from("categories")
    .select(STAFF_SELECTS.categories)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/** Existing brands (id and name only) for the optional "Marca" of the photo drafts. */
export async function listStaffBrands() {
  const rows: Array<{ id: string; name: string }> = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await adminDb().from("brands").select(STAFF_SELECTS.brands).order("name").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Array<{ id: string; name: string }>));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function brandExists(brandId: string) {
  const { data, error } = await adminDb().from("brands").select("id").eq("id", brandId).maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type StaffResult<T = Record<string, never>> = ({ ok: true; message: string } & T) | { ok: false; error: string };

function checkPhoto(photo: File | null | undefined): string | null {
  if (!photo) return null;
  if (!PHOTO_EXTENSIONS[photo.type]) return "La foto debe ser JPG, PNG o WEBP.";
  if (photo.size > MAX_STAFF_PHOTO_BYTES) return "La foto pesa demasiado. Vuelve a tomarla desde el panel (se reduce sola).";
  return null;
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "23505" || /duplicate key/i.test(error.message ?? "")));
}

function isAlreadyStored(error: unknown) {
  const detail = error as { message?: string; statusCode?: string | number; status?: number } | null;
  return Boolean(detail && (String(detail.statusCode) === "409" || detail.status === 409 || /already exists|duplicate/i.test(detail.message ?? "")));
}

/**
 * `fixedKey` (idempotent photo drafts): the same key on every attempt, so a
 * repeated upload finds the object already there and a repeated row hits the
 * UNIQUE storage_key — never a second image.
 */
async function uploadProductPhoto(productId: string, photo: File, sortOrder: number, fixedKey?: string) {
  const key = fixedKey ?? `${productId}/${crypto.randomUUID()}.${PHOTO_EXTENSIONS[photo.type]}`;
  const { error } = await adminStorage().from(PRODUCT_IMAGE_BUCKET).upload(key, photo, { contentType: photo.type, upsert: false });
  if (error && !(fixedKey && isAlreadyStored(error))) throw new Error(error.message);
  const { error: rowError } = await adminDb().from("product_images").insert({ product_id: productId, storage_key: key, sort_order: sortOrder });
  if (rowError) {
    if (fixedKey && isUniqueViolation(rowError)) return;
    // With a fixed key another attempt may own the object: leave it for the retry.
    if (!fixedKey) await adminStorage().from(PRODUCT_IMAGE_BUCKET).remove([key]).catch(() => {});
    throw new Error(rowError.message);
  }
}

const CLIENT_REF_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function draftPhotoKey(productId: string, photo: File) {
  return `${productId}/borrador-${productId.slice(0, 8)}.${PHOTO_EXTENSIONS[photo.type]}`;
}

type DraftResumeRow = {
  id: string;
  name: string;
  catalog_type: string;
  is_active: boolean;
  created_by_admin_id: string | null;
  product_variants: Array<{ id: string; name: string }> | null;
  product_images: Array<{ storage_key: string }> | null;
};

async function readDraftResume(productId: string) {
  const { data, error } = await adminDb().from("products").select(STAFF_SELECTS.draftResume).eq("id", productId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as DraftResumeRow | null) ?? null;
}

/**
 * A creation with this clientRef already reached the database (its response was
 * lost, or two attempts overlapped). Finish whatever the first attempt could
 * not (variant, photo, audit row) WITHOUT creating anything twice, and answer
 * with the same product. Stock is never written here: only the attempt that
 * inserted the product writes its opening stock.
 */
async function resumeStaffCreation(
  existing: DraftResumeRow,
  input: { adminId: string; clientRef: string; photo?: File | null; draft?: boolean },
  variants: NewStaffVariant[],
  single: boolean,
): Promise<StaffResult<{ productId: string; variantId: string | null; resumed: true }>> {
  if (existing.created_by_admin_id !== input.adminId || existing.catalog_type !== "IMMEDIATE") {
    return { ok: false, error: "Esta foto ya está ligada a otro producto. Quítala de la lista y vuelve a agregarla." };
  }
  const db = adminDb();
  const productId = existing.id;
  let variantRows = existing.product_variants ?? [];
  const warnings: string[] = [];
  if (!variantRows.length) {
    // The first attempt stopped between the product and its variants.
    const inserted = await db.from("product_variants").insert(variantInsertRows(productId, variants, single)).select("id, name");
    if (inserted.error && !isUniqueViolation(inserted.error)) {
      return { ok: false, error: describeError(new Error(inserted.error.message), "No fue posible completar el producto. Intenta de nuevo.") };
    }
    const reread = await db.from("product_variants").select("id, name").eq("product_id", productId);
    if (reread.error) return { ok: false, error: reread.error.message };
    variantRows = (reread.data ?? []) as Array<{ id: string; name: string }>;
  }
  if (input.photo && !(existing.product_images ?? []).length) {
    try {
      await uploadProductPhoto(productId, input.photo, 0, draftPhotoKey(productId, input.photo));
    } catch (error) {
      warnings.push(` La foto no se pudo guardar (${error instanceof Error ? error.message : "error de almacenamiento"}).`);
    }
  }
  // Audit row only if the first attempt never wrote it. An overlapping attempt
  // may still be about to: give it a moment before writing ours (a rare double
  // audit row is preferable to a missing one).
  const hasLog = async () => {
    const logged = await db.from("activity_logs").select("id").eq("action", "PRODUCT_CREATED_STAFF").eq("entity_id", productId).limit(1);
    return Boolean(logged.error) || (logged.data ?? []).length > 0;
  };
  if (!(await hasLog()) && !(await new Promise((resolve) => setTimeout(resolve, 1500)).then(hasLog))) {
    await logActivity({
      adminUserId: input.adminId,
      action: "PRODUCT_CREATED_STAFF",
      entityType: "products",
      entityId: productId,
      newData: { name: existing.name, catalog_type: "IMMEDIATE", is_public: false, client_ref: input.clientRef, draft: Boolean(input.draft), resumed: true },
    });
  }
  const sorted = [...variantRows].sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { ok: true, productId, variantId: sorted[0]?.id ?? null, resumed: true, message: `"${existing.name}" ya estaba guardado (no se duplicó).${warnings.join("")}` };
}

function variantInsertRows(productId: string, variants: NewStaffVariant[], single: boolean) {
  return variants.map((variant) => ({
    product_id: productId,
    name: single ? "Único" : variant.name,
    price_cents: variant.priceCents,
    attributes: single ? {} : { variante: variant.name },
    is_active: true,
  }));
}

/** A $0 product must not get stock: the POS would sell it for free. */
export const STOCK_NEEDS_PRICE_MESSAGE = "Primero ponle precio de venta: un producto a $0 no puede tener existencia.";

export type NewStaffVariant = { name: string; priceCents: number; quantity: number };

/**
 * "Añadir producto" from the staff panel: an Entrega inmediata product in La
 * Paz, HIDDEN from the public catalogue until the owner publishes it (she sees
 * it in Productos entrega inmediata and uses the same Visible/Oculto chip, which
 * refuses to publish at $0). Sale price only; the purchase cost stays at 0 for
 * the owner to fill in. Opening stock enters as RECEIPT movements signed by the
 * employee (recordManualMovement, the same ledger writer the owner uses).
 *
 * `clientRef` (uuid of a browser draft) makes the call idempotent: it becomes
 * the product id, so the primary key itself refuses a second product for the
 * same draft — also when two attempts overlap. A repeat answers with the
 * existing product (resumeStaffCreation) instead of creating another one.
 *
 * `draft` = "Añadir productos desde fotos": only the photo is required. Name,
 * price and quantity are NOT taken from the browser: the product is created
 * with a provisional name, one "Único" variant at $0 and no stock (no
 * movement), to be completed afterwards with the staff edit actions. A $0
 * product cannot be published (setProductPublic) and, with no stock, cannot be
 * sold or confirmed in an order; stock is refused while the price is $0.
 */
export async function createStaffProduct(input: {
  adminId: string;
  name: string;
  categoryId: string | null;
  variants: NewStaffVariant[];
  photo?: File | null;
  clientRef?: string | null;
  draft?: boolean;
  brandId?: string | null;
}): Promise<StaffResult<{ productId: string; variantId: string | null; resumed?: boolean }>> {
  const clientRef = input.clientRef?.trim() || null;
  if (clientRef && !CLIENT_REF_PATTERN.test(clientRef)) return { ok: false, error: "La referencia del borrador no es válida. Vuelve a agregar la foto." };
  if (input.draft) {
    if (!clientRef) return { ok: false, error: "Falta la referencia del borrador. Recarga la página." };
    if (!input.photo) return { ok: false, error: "Agrega la foto del producto." };
  }
  const name = input.draft ? input.name.trim() || provisionalProductName(new Date()) : input.name.trim();
  if (!name) return { ok: false, error: "Escribe el nombre del producto." };
  if (name.length > 140) return { ok: false, error: "El nombre no puede exceder 140 caracteres." };
  const photoError = checkPhoto(input.photo);
  if (photoError) return { ok: false, error: photoError };

  const variants = input.draft
    ? [{ name: "Único", priceCents: 0, quantity: 0 }]
    : input.variants.map((variant) => ({ ...variant, name: variant.name.trim() }));
  if (!variants.length) return { ok: false, error: "Agrega al menos una variante con su precio." };
  if (variants.length > 20) return { ok: false, error: "Máximo 20 variantes por producto." };
  const seen = new Set<string>();
  for (const variant of input.draft ? [] : variants) {
    if (!variant.name) return { ok: false, error: "Cada variante necesita un nombre." };
    const key = variant.name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `La variante "${variant.name}" está repetida.` };
    seen.add(key);
    if (!Number.isInteger(variant.priceCents) || variant.priceCents <= 0) {
      return { ok: false, error: `Escribe el precio de venta de "${variant.name}" (mayor que $0).` };
    }
    if (!Number.isInteger(variant.quantity) || variant.quantity < 0 || variant.quantity > 100000) {
      return { ok: false, error: `La cantidad de "${variant.name}" debe ser un número entero de 0 o más.` };
    }
  }

  const db = adminDb();
  if (input.categoryId) {
    const { data: category } = await db.from("categories").select("id").eq("id", input.categoryId).eq("is_active", true).maybeSingle();
    if (!category) return { ok: false, error: "La categoría elegida ya no existe." };
  }
  if (input.brandId && !(await brandExists(input.brandId))) return { ok: false, error: "La marca elegida ya no existe." };

  // One variant called "Único" is a basic product, like the owner's form makes it.
  const single = variants.length === 1 && variants[0].name.toLowerCase() === "único";
  const idempotency = clientRef ? { adminId: input.adminId, clientRef, photo: input.photo, draft: input.draft } : null;
  if (idempotency) {
    const existing = await readDraftResume(clientRef!);
    if (existing) return resumeStaffCreation(existing, idempotency, variants, single);
  }

  let slug = await ensureUniqueSlug("products", slugify(name));
  const insertProduct = (candidate: string) =>
    db
      .from("products")
      .insert({
        ...(clientRef ? { id: clientRef } : {}),
        name,
        slug: candidate,
        category_id: input.categoryId,
        ...(input.brandId ? { brand_id: input.brandId } : {}),
        catalog_type: "IMMEDIATE",
        product_kind: single ? "SIMPLE" : "VARIANTS",
        is_public: false,
        is_active: true,
        created_by_admin_id: input.adminId,
      })
      .select("id")
      .single();
  let { data: product, error: productError } = await insertProduct(slug);
  if (productError && idempotency && isUniqueViolation(productError)) {
    // Either another attempt of this same draft won the primary key (resume
    // it), or the slug was taken in between (try once more with a suffix).
    const existing = await readDraftResume(clientRef!);
    if (existing) return resumeStaffCreation(existing, idempotency, variants, single);
    slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
    ({ data: product, error: productError } = await insertProduct(slug));
  }
  if (productError || !product) {
    return { ok: false, error: describeError(new Error(productError?.message ?? "error desconocido"), "No fue posible crear el producto.") };
  }
  const productId = product.id as string;

  let { data: variantRows, error: variantError } = await db
    .from("product_variants")
    .insert(variantInsertRows(productId, variants, single))
    .select("id, name");
  if (variantError && idempotency && isUniqueViolation(variantError)) {
    // An overlapping attempt of the same draft already added them.
    ({ data: variantRows, error: variantError } = await db.from("product_variants").select("id, name").eq("product_id", productId));
  }
  if (variantError || !variantRows) {
    // Undo the half-created product of THIS request (nothing references it yet).
    await db.from("products").delete().eq("id", productId);
    return { ok: false, error: describeError(new Error(variantError?.message ?? "error desconocido"), "No fue posible crear las variantes.") };
  }

  const warnings: string[] = [];
  for (const created of variantRows as Array<{ id: string; name: string }>) {
    const quantity = variants.find((variant) => variant.name.toLowerCase() === created.name.toLowerCase())?.quantity ?? 0;
    if (quantity <= 0) continue;
    const movement = await recordManualMovement({
      variantId: created.id,
      movementType: "RECEIPT",
      quantityDelta: quantity,
      reason: "Existencia inicial (alta desde el panel de empleado)",
      adminId: input.adminId,
    });
    if (!movement.ok) warnings.push(` No se registró la existencia de "${created.name}": ${movement.error}`);
  }

  if (input.photo) {
    try {
      await uploadProductPhoto(productId, input.photo, 0, clientRef ? draftPhotoKey(productId, input.photo) : undefined);
    } catch (error) {
      warnings.push(` La foto no se pudo guardar (${error instanceof Error ? error.message : "error de almacenamiento"}).`);
    }
  }

  await logActivity({
    adminUserId: input.adminId,
    action: "PRODUCT_CREATED_STAFF",
    entityType: "products",
    entityId: productId,
    newData: {
      name,
      slug,
      catalog_type: "IMMEDIATE",
      is_public: false,
      variants: variants.map((variant) => ({ name: variant.name, price_cents: variant.priceCents, quantity: variant.quantity })),
      ...(clientRef ? { client_ref: clientRef } : {}),
      ...(input.draft ? { draft: true } : {}),
      ...(input.brandId ? { brand_id: input.brandId } : {}),
    },
  });

  const firstVariant = [...(variantRows as Array<{ id: string; name: string }>)].sort((a, b) => a.name.localeCompare(b.name, "es"))[0];
  return {
    ok: true,
    productId,
    variantId: firstVariant?.id ?? null,
    message: input.draft
      ? `Foto guardada como "${name}" (oculto, sin precio ni existencia todavía).${warnings.join("")}`
      : `"${name}" quedó registrado como oculto: la dueña lo revisa y lo publica.${warnings.join("")}`,
  };
}

type VariantContext = {
  id: string;
  product_id: string;
  name: string;
  price_cents: number;
  is_active: boolean;
  products: {
    id: string;
    name: string;
    product_kind: string | null;
    catalog_type: string;
    is_active: boolean;
    is_public: boolean;
    created_by_admin_id: string | null;
  } | null;
};

async function readVariant(variantId: string): Promise<VariantContext | null> {
  const { data, error } = await adminDb().from("product_variants").select(STAFF_SELECTS.variant).eq("id", variantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as VariantContext & { products: VariantContext["products"] | VariantContext["products"][] };
  return { ...row, products: Array.isArray(row.products) ? (row.products[0] ?? null) : row.products };
}

/** Parses "3" / "1.5" into the quantity of an entry: whole units, decimals only for products sold by measure. */
export function parseEntryQuantity(raw: unknown, measured: boolean): { ok: true; value: number } | { ok: false; error: string } {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return { ok: false, error: "Escribe la cantidad que entra (un número mayor que cero)." };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "La cantidad debe ser mayor que cero." };
  if (!measured && !Number.isInteger(value)) return { ok: false, error: "Este producto solo admite piezas enteras (1, 2, 3…)." };
  if (value > 100000) return { ok: false, error: "Esa cantidad es demasiado grande. Revísala." };
  return { ok: true, value };
}

/**
 * "Registrar entrada": a RECEIPT movement on an existing La Paz variant, signed
 * by the employee, with an optional evidence photo (private bucket) and note.
 */
export async function recordStaffEntry(input: {
  adminId: string;
  variantId: string;
  quantity: unknown;
  note: string;
  photo?: File | null;
  /**
   * Retry-safe first entry (photo drafts): the RECEIPT is written only while
   * the stock is still this number; if it already equals expected + quantity
   * the entry is reported as done (a repeated request never doubles it).
   */
  expectedStock?: number | null;
}): Promise<StaffResult<{ productId: string }>> {
  const photoError = checkPhoto(input.photo);
  if (photoError) return { ok: false, error: photoError };
  const note = input.note.trim().slice(0, 300);

  const variant = await readVariant(input.variantId);
  const product = variant?.products;
  if (!variant || !product) return { ok: false, error: "Ese producto ya no existe." };
  if (product.catalog_type !== "IMMEDIATE" || !product.is_active) {
    return { ok: false, error: "Solo se registran entradas de productos de entrega inmediata activos." };
  }
  if (!variant.is_active) return { ok: false, error: "Esa variante está desactivada." };
  const transit = await adminDb().from("products").select(STAFF_SELECTS.transit).eq("id", product.id).maybeSingle();
  if (!transit.error && (transit.data as { in_transit?: boolean } | null)?.in_transit) {
    return { ok: false, error: "Este producto todavía viene en camino: la dueña lo marca como recibido primero." };
  }

  const quantity = parseEntryQuantity(input.quantity, product.product_kind === "MEASURED");
  if (!quantity.ok) return quantity;
  // Her own hidden product still at $0 (a photo draft): price first.
  if (product.created_by_admin_id === input.adminId && !product.is_public && Number(variant.price_cents ?? 0) <= 0) {
    return { ok: false, error: STOCK_NEEDS_PRICE_MESSAGE };
  }
  if (input.expectedStock !== undefined && input.expectedStock !== null) {
    if (!Number.isFinite(input.expectedStock) || input.expectedStock < 0) return { ok: false, error: "Revisa la existencia esperada." };
    const current = (await getStockFor([variant.id])).get(variant.id) ?? 0;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    if (round(current) === round(input.expectedStock + quantity.value)) {
      return { ok: true, productId: product.id, message: `La entrada de ${quantity.value} ya estaba registrada (no se duplicó).` };
    }
    if (round(current) !== round(input.expectedStock)) {
      return { ok: false, error: `La existencia de este producto cambió (ahora hay ${current}). Corrígela en la lista de inventario.` };
    }
  }

  let evidenceKey: string | null = null;
  if (input.photo) {
    evidenceKey = `${STOCK_ENTRY_PHOTO_PREFIX}/${variant.id}/${crypto.randomUUID()}.${PHOTO_EXTENSIONS[input.photo.type]}`;
    const { error } = await adminStorage().from(EXPENSE_RECEIPT_BUCKET).upload(evidenceKey, input.photo, { contentType: input.photo.type, upsert: false });
    if (error) return { ok: false, error: `No fue posible subir la foto: ${error.message}` };
  }

  const movement = await recordManualMovement({
    variantId: variant.id,
    movementType: "RECEIPT",
    quantityDelta: quantity.value,
    reason: note ? `Entrada (panel de empleado): ${note}` : "Entrada (panel de empleado)",
    adminId: input.adminId,
    evidenceStorageKey: evidenceKey,
  });
  if (!movement.ok) {
    if (evidenceKey) await adminStorage().from(EXPENSE_RECEIPT_BUCKET).remove([evidenceKey]).catch(() => {});
    return movement;
  }
  let warning = "";
  if (evidenceKey && movement.evidenceSaved === false) {
    await adminStorage().from(EXPENSE_RECEIPT_BUCKET).remove([evidenceKey]).catch(() => {});
    warning = ` La foto no se guardó: falta aplicar ${STAFF_DELIVERIES_MIGRATION_FILE}.`;
  }

  await logActivity({
    adminUserId: input.adminId,
    action: "STOCK_RECEIPT_STAFF",
    entityType: "inventory_movements",
    entityId: movement.movementId ?? variant.id,
    newData: { variantId: variant.id, productId: product.id, quantity: quantity.value, note: note || null, photo: Boolean(evidenceKey) && !warning },
  });
  return {
    ok: true,
    productId: product.id,
    message: `Entrada registrada: +${quantity.value} de ${product.name}${variant.name === "Único" ? "" : ` · ${variant.name}`}.${warning}`,
  };
}

/**
 * The employee may correct the SALE price of the variants of a product they
 * created, while it is still hidden (once the owner publishes it, the price is
 * hers). Written through updateVariantQuick, the owner's own price writer.
 */
export async function updateStaffVariantPrice(input: { adminId: string; variantId: string; priceCents: number }): Promise<StaffResult<{ productId: string }>> {
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) return { ok: false, error: "Escribe un precio de venta mayor que $0." };
  if (input.priceCents > 100_000_000) return { ok: false, error: "Ese precio es demasiado alto. Revísalo." };
  const variant = await readVariant(input.variantId);
  const product = variant?.products;
  if (!variant || !product) return { ok: false, error: "Ese producto ya no existe." };
  if (product.created_by_admin_id !== input.adminId) {
    return { ok: false, error: "Solo puedes corregir el precio de los productos que tú diste de alta." };
  }
  if (product.is_public) return { ok: false, error: "La dueña ya publicó este producto: pídele a ella el cambio de precio." };

  const result = await updateVariantQuick({ variantId: variant.id, field: "price", value: input.priceCents, adminId: input.adminId });
  if (!result.ok) return result;
  if (result.changed) {
    await logActivity({
      adminUserId: input.adminId,
      action: "PRODUCT_PRICE_UPDATED_STAFF",
      entityType: "product_variants",
      entityId: variant.id,
      previousData: { price_cents: result.previous },
      newData: { price_cents: result.next },
    });
  }
  return { ok: true, productId: product.id, message: result.changed ? "Precio de venta actualizado." : "El precio ya era ese." };
}

/** Adds one photo to a La Paz product the employee created (max 3 per product, like the owner's form). */
export async function addStaffProductPhoto(input: { adminId: string; productId: string; photo: File | null }): Promise<StaffResult<{ productId: string }>> {
  if (!input.photo) return { ok: false, error: "Toma o elige una foto." };
  const photoError = checkPhoto(input.photo);
  if (photoError) return { ok: false, error: photoError };
  const db = adminDb();
  const { data, error } = await db
    .from("products")
    .select(STAFF_SELECTS.productOwnership)
    .eq("id", input.productId)
    .maybeSingle();
  if (error) return { ok: false, error: describeError(new Error(error.message), "No fue posible leer el producto.") };
  if (!data || data.catalog_type !== "IMMEDIATE" || !data.is_active) return { ok: false, error: "Ese producto ya no existe." };
  if (data.created_by_admin_id !== input.adminId) return { ok: false, error: "Solo puedes agregar fotos a los productos que tú diste de alta." };
  if (data.is_public) return { ok: false, error: "La dueña ya publicó este producto: sus fotos las cambia ella." };
  const count = ((data.product_images ?? []) as unknown[]).length;
  if (count >= MAX_PRODUCT_IMAGES) return { ok: false, error: `Este producto ya tiene ${MAX_PRODUCT_IMAGES} fotos.` };
  try {
    await uploadProductPhoto(input.productId, input.photo, count);
  } catch (uploadError) {
    return { ok: false, error: `No fue posible guardar la foto: ${uploadError instanceof Error ? uploadError.message : "error"}` };
  }
  await logActivity({ adminUserId: input.adminId, action: "PRODUCT_PHOTO_ADDED_STAFF", entityType: "products", entityId: input.productId });
  return { ok: true, productId: input.productId, message: "Foto agregada." };
}

/** Employee edits remain limited to their own hidden products. */
/**
 * `brandId`: undefined leaves the brand alone (the inventory edit form does not
 * send it); null clears it; an id must be an existing brand (never created here).
 */
export async function editStaffProduct(input: { adminId: string; productId: string; name: string; categoryId: string | null; brandId?: string | null }): Promise<StaffResult<{ productId: string }>> {
  const name = input.name.trim();
  if (!name || name.length > 140) return { ok: false, error: "Escribe un nombre de hasta 140 caracteres." };
  const db = adminDb();
  const { data: product, error } = await db.from("products").select("id,name,slug,category_id,brand_id,created_by_admin_id,is_public,catalog_type,is_active").eq("id", input.productId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!product || product.catalog_type !== "IMMEDIATE" || !product.is_active || product.created_by_admin_id !== input.adminId || product.is_public) return { ok: false, error: "Solo puedes editar los productos que tú creaste y que la dueña aún no publicó." };
  if (input.categoryId && !(await listStaffCategories()).some((category) => category.id === input.categoryId)) return { ok: false, error: "La categoría no está disponible." };
  const brandChange = input.brandId !== undefined;
  if (brandChange && input.brandId && !(await brandExists(input.brandId))) return { ok: false, error: "Esa marca no existe. Elige una de la lista." };
  const changes: Record<string, unknown> = { name, category_id: input.categoryId, updated_at: new Date().toISOString() };
  if (brandChange) changes.brand_id = input.brandId ?? null;
  // A photo draft gets its real slug the first time it gets a real name.
  if (String(product.name ?? "").startsWith(DRAFT_PRODUCT_NAME_PREFIX) && !name.startsWith(DRAFT_PRODUCT_NAME_PREFIX)) {
    changes.slug = await ensureUniqueSlug("products", slugify(name), product.id);
  }
  const result = await db.from("products").update(changes).eq("id", product.id).eq("created_by_admin_id", input.adminId).eq("is_public", false).select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, error: result.error?.message ?? "El producto cambió. Recarga la página." };
  await logActivity({
    adminUserId: input.adminId,
    action: "PRODUCT_UPDATED_STAFF",
    entityType: "products",
    entityId: product.id,
    previousData: { name: product.name, category_id: product.category_id, ...(brandChange ? { brand_id: product.brand_id ?? null } : {}) },
    newData: { name, category_id: input.categoryId, ...(brandChange ? { brand_id: input.brandId ?? null } : {}), ...(changes.slug ? { slug: changes.slug } : {}) },
  });
  return { ok: true, productId: product.id, message: brandChange ? "Nombre, marca y categoría guardados." : "Nombre y categoría guardados." };
}

/** `quantity` null = rename / price only, the stock is left as it is. */
export async function editStaffVariant(input: { adminId: string; variantId: string; name: string; priceCents: number; quantity: number | null }): Promise<StaffResult<{ productId: string }>> {
  const name = input.name.trim();
  if (!name || name.length > 100) return { ok: false, error: "Escribe una variante de hasta 100 caracteres." };
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0 || input.priceCents > 100_000_000) return { ok: false, error: "Revisa el precio de venta." };
  const context = await readVariant(input.variantId);
  const product = context?.products;
  if (!context || !product || !context.is_active || !product.is_active || product.catalog_type !== "IMMEDIATE" || product.created_by_admin_id !== input.adminId || product.is_public) return { ok: false, error: "Solo puedes editar los productos que tú creaste y que la dueña aún no publicó." };
  const quantity = input.quantity;
  if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000 || (product.product_kind !== "MEASURED" && !Number.isInteger(quantity)))) return { ok: false, error: "Revisa la existencia: no puede ser negativa." };
  const db = adminDb();
  const siblings = await db.from("product_variants").select("id,name").eq("product_id", product.id).eq("is_active", true);
  if (siblings.error) return { ok: false, error: siblings.error.message };
  if (siblings.data.some((variant) => variant.id !== context.id && variant.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "Ya existe otra variante con ese nombre." };
  const renamed = await db.from("product_variants").update({ name, updated_at: new Date().toISOString() }).eq("id", context.id);
  if (renamed.error) return { ok: false, error: renamed.error.message };
  const price = await updateVariantQuick({ variantId: context.id, field: "price", value: input.priceCents, adminId: input.adminId });
  if (!price.ok) return { ok: false, error: `El nombre se guardó; no se pudo guardar el precio: ${price.error}` };
  if (quantity !== null) {
    const stock = await updateVariantQuick({ variantId: context.id, field: "stock", value: quantity, adminId: input.adminId });
    if (!stock.ok) return { ok: false, error: `Nombre y precio guardados; no se pudo ajustar la existencia: ${stock.error}` };
  }
  await logActivity({ adminUserId: input.adminId, action: "PRODUCT_VARIANT_UPDATED_STAFF", entityType: "product_variants", entityId: context.id, newData: { name, price_cents: input.priceCents, ...(quantity !== null ? { stock: quantity } : {}) } });
  return { ok: true, productId: product.id, message: quantity !== null ? "Variante, precio y existencia guardados." : "Variante y precio guardados." };
}

export async function updateStaffInventoryField(input: { adminId: string; variantId: string; field: "price" | "stock"; value: number }): Promise<StaffResult<{ productId: string }>> {
  if (input.field === "price") return updateStaffVariantPrice({ adminId: input.adminId, variantId: input.variantId, priceCents: input.value });
  const context = await readVariant(input.variantId);
  const product = context?.products;
  if (!context || !product || !context.is_active || !product.is_active || product.catalog_type !== "IMMEDIATE" || product.created_by_admin_id !== input.adminId || product.is_public) return { ok: false, error: "Solo puedes editar tus productos aún ocultos." };
  if (!Number.isFinite(input.value) || input.value < 0 || input.value > 1_000_000 || (product.product_kind !== "MEASURED" && !Number.isInteger(input.value))) return { ok: false, error: "Revisa la existencia." };
  if (input.value > 0 && Number(context.price_cents ?? 0) <= 0) return { ok: false, error: STOCK_NEEDS_PRICE_MESSAGE };
  const result = await updateVariantQuick({ variantId: input.variantId, field: "stock", value: input.value, adminId: input.adminId });
  if (!result.ok) return result;
  return { ok: true, productId: product.id, message: "Existencia guardada." };
}

export async function archiveStaffProducts(adminId: string, productIds: string[]): Promise<StaffResult<{ productId: string }>> {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (!ids.length || ids.length > 50) return { ok: false, error: "Selecciona entre 1 y 50 productos." };
  const db = adminDb();
  const { data, error } = await db.from("products").select(STAFF_SELECTS.productOwnership).in("id", ids);
  if (error) return { ok: false, error: error.message };
  if (!data || data.length !== ids.length || data.some(product => product.created_by_admin_id !== adminId || product.is_public || !product.is_active || product.catalog_type !== "IMMEDIATE")) return { ok: false, error: "Solo puedes archivar tus productos aún ocultos." };
  const result = await db.from("products").update({ is_active: false, is_public: false, updated_at: new Date().toISOString() }).in("id", ids).eq("created_by_admin_id", adminId).eq("is_public", false).select("id");
  if (result.error) return { ok: false, error: result.error.message };
  if (result.data?.length !== ids.length) return { ok: false, error: "Algún producto cambió. Recarga para revisar los productos archivados." };
  await logActivity({ adminUserId: adminId, action: "PRODUCT_ARCHIVED_STAFF", entityType: "products", entityId: ids.join(","), newData: { count: ids.length } });
  return { ok: true, productId: ids[0], message: `${ids.length} producto(s) archivado(s). Su historial se conserva.` };
}

export async function duplicateStaffProduct(adminId: string, productId: string): Promise<StaffResult<{ productId: string }>> {
  const { data, error } = await adminDb().from("products").select(STAFF_SELECTS.products).eq("id", productId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data || data.created_by_admin_id !== adminId || data.is_public || !data.is_active || data.catalog_type !== "IMMEDIATE") return { ok: false, error: "Solo puedes duplicar tus productos aún ocultos." };
  const product = toStaffProduct(data as unknown as ProductRowRaw, new Map());
  const result = await createStaffProduct({ adminId, name: `${product.name.slice(0,132)} (copia)`, categoryId: product.categoryId, variants: product.variants.map(variant => ({ name: variant.name, priceCents: variant.priceCents, quantity: 0 })) });
  if (!result.ok) return result;
  return { ...result, message: "Copia creada como oculta, sin fotos ni existencias. Completa sus datos." };
}
