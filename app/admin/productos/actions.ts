"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { parseMoneyToCents, parseQuantity, slugify } from "../../../lib/format";
import {
  QUICK_STOCK_REASON,
  ensureUniqueSlug,
  markProductReceived,
  setProductPublic,
  updateCostSetting,
  updateVariantQuick,
} from "../../../lib/supabase/admin-catalog";
import { IN_TRANSIT_MIGRATION_FILE } from "../../../lib/supabase/in-transit";
import { parseUsdToCents, type StoreCostActionState } from "../../../lib/supabase/store-cost";
import {
  MAX_PRODUCT_IMAGES,
  PRODUCT_IMAGE_BUCKET,
  adminDb,
  adminStorage,
  logActivity,
  requireAdminActor,
} from "../../../lib/supabase/business";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type ProductKind = "SIMPLE" | "VARIANTS" | "MEASURED";

/**
 * products.weekly_plan_eligible only exists once
 * database/migrations/004_weekly_plan_checkout.sql has been applied, and
 * products.in_transit once database/migrations/008_products_in_transit.sql has.
 * Rather than fail the whole create/update when one is missing, retry without
 * the missing field(s) so the rest of the product still saves, and tell the
 * admin why the switch didn't stick (only when it was actually switched on).
 */
function isMissingColumnError(message: string) {
  return message.includes("does not exist") || message.includes("schema cache") || message.includes("Could not find the");
}

const WEEKLY_PLAN_MIGRATION_WARNING =
  " El plan semanal no se guardó: aplica database/migrations/004_weekly_plan_checkout.sql en Supabase.";

/**
 * Saving merchandise as "en camino" without the column would quietly turn it
 * into regular, sellable Entrega inmediata stock — so that one is refused
 * instead of dropped. (in_transit = false is dropped silently: it is exactly
 * what every product already is before the migration.)
 */
const IN_TRANSIT_MIGRATION_BLOCKED = `No se guardó: para marcar mercancía “en camino” primero aplica ${IN_TRANSIT_MIGRATION_FILE} en el editor SQL de Supabase. Si ya la tienes en la tienda, desmarca “Viene en camino”.`;

type OptionalColumn = { column: string; value: unknown; warning: string; blockIfMissing?: string };

async function writeWithOptionalColumns<R extends { error: { message: string } | null }>(
  write: (optionalFields: Record<string, unknown>) => PromiseLike<R>,
  optional: OptionalColumn[],
): Promise<{ result: R; warning: string; blocked: string | null }> {
  let remaining = optional;
  for (;;) {
    const result = await write(Object.fromEntries(remaining.map((field) => [field.column, field.value])));
    const message = result.error?.message ?? "";
    if (!result.error || !remaining.length || !isMissingColumnError(message)) {
      const dropped = optional.filter((field) => !remaining.includes(field));
      return { result, warning: dropped.map((field) => field.warning).join(""), blocked: null };
    }
    // Drop the column(s) the error names; if it names none of ours, drop them all.
    const named = remaining.filter((field) => message.includes(field.column));
    const dropping = named.length ? named : remaining;
    const blocking = dropping.find((field) => field.blockIfMissing);
    if (blocking) return { result, warning: "", blocked: blocking.blockIfMissing ?? null };
    remaining = remaining.filter((field) => !dropping.includes(field));
  }
}

function optionalProductColumns(weeklyPlanEligible: boolean, inTransit: boolean): OptionalColumn[] {
  return [
    {
      column: "weekly_plan_eligible",
      value: weeklyPlanEligible,
      warning: weeklyPlanEligible ? WEEKLY_PLAN_MIGRATION_WARNING : "",
    },
    {
      column: "in_transit",
      value: inTransit,
      warning: "",
      blockIfMissing: inTransit ? IN_TRANSIT_MIGRATION_BLOCKED : undefined,
    },
  ];
}

/** Only Entrega inmediata merchandise can be "en camino"; ON_DEMAND is always false. */
function readInTransit(formData: FormData, catalogType: "ON_DEMAND" | "IMMEDIATE") {
  return catalogType === "IMMEDIATE" && formData.get("inTransit") === "on";
}

function revalidateCatalog() {
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/entrega-inmediata");
  revalidatePath("/admin/productos/en-camino");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/vender");
  revalidatePath("/catalogo");
  revalidatePath("/entrega-inmediata");
  revalidatePath("/por-pedido");
}

type ParsedVariant = {
  name: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  costCents: number;
  quantity: number;
  minQuantity: number;
  unitLabel: string | null;
  attributes: Record<string, string>;
};

/** Reads the form into variants. All three product kinds end up as product_variants
 *  rows: a basic product is simply one variant, which keeps a single stock ledger. */
function parseVariants(formData: FormData, kind: ProductKind): { variants: ParsedVariant[]; error: string | null } {
  if (kind === "VARIANTS") {
    const names = formData.getAll("variantName").map((value) => String(value).trim());
    const variants: ParsedVariant[] = [];
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (!name) continue;
      const priceCents = parseMoneyToCents(formData.getAll("variantPrice")[index] ?? "");
      const costCents = parseMoneyToCents(formData.getAll("variantCost")[index] ?? "") ?? 0;
      const quantity = parseQuantity(formData.getAll("variantQuantity")[index] ?? "") ?? 0;
      const minQuantity = parseQuantity(formData.getAll("variantMinQuantity")[index] ?? "") ?? 0;
      const sku = String(formData.getAll("variantSku")[index] ?? "").trim();
      if (priceCents === null || priceCents < 0) return { variants: [], error: `El precio de la variante "${name}" no es válido.` };
      if (costCents < 0 || quantity < 0 || minQuantity < 0) {
        return { variants: [], error: `Los valores de la variante "${name}" no pueden ser negativos.` };
      }
      variants.push({
        name,
        sku: sku || null,
        barcode: null,
        priceCents,
        costCents,
        quantity,
        minQuantity,
        unitLabel: null,
        attributes: { variante: name },
      });
    }
    if (!variants.length) return { variants: [], error: "Agrega al menos una variante con nombre y precio." };
    const duplicated = new Set<string>();
    for (const variant of variants) {
      const key = variant.name.toLowerCase();
      if (duplicated.has(key)) return { variants: [], error: `La variante "${variant.name}" está repetida.` };
      duplicated.add(key);
    }
    return { variants, error: null };
  }

  const priceCents = parseMoneyToCents(formData.get("price"));
  const costCents = parseMoneyToCents(formData.get("cost")) ?? 0;
  const quantity = parseQuantity(formData.get("quantity")) ?? 0;
  const minQuantity = parseQuantity(formData.get("minQuantity")) ?? 0;
  const unitLabel = String(formData.get("unitLabel") ?? "").trim();
  const sku = String(formData.get("internalCode") ?? "").trim();
  const barcode = String(formData.get("barcode") ?? "").trim();

  if (priceCents === null) return { variants: [], error: "El precio de venta es obligatorio." };
  if (priceCents < 0 || costCents < 0) return { variants: [], error: "El precio y el costo no pueden ser negativos." };
  if (quantity < 0 || minQuantity < 0) return { variants: [], error: "Las cantidades no pueden ser negativas." };
  if (kind === "MEASURED" && !unitLabel) return { variants: [], error: "Indica la unidad de medida (kg, m, l…)." };
  if (kind !== "MEASURED" && !Number.isInteger(quantity)) {
    return { variants: [], error: "Un producto básico o con variantes solo admite cantidades enteras." };
  }

  return {
    variants: [
      {
        name: kind === "MEASURED" ? `Por ${unitLabel}` : "Único",
        sku: sku || null,
        barcode: barcode || null,
        priceCents,
        costCents,
        quantity,
        minQuantity,
        unitLabel: kind === "MEASURED" ? unitLabel : null,
        attributes: kind === "MEASURED" ? { unidad_de_medida: unitLabel } : {},
      },
    ],
    error: null,
  };
}

async function resolveCategoryId(formData: FormData) {
  const newCategory = String(formData.get("newCategoryName") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  if (!newCategory) return categoryId || null;

  const db = adminDb();
  const { data: existing } = await db.from("categories").select("id").eq("name", newCategory).maybeSingle();
  if (existing?.id) return existing.id as string;

  const slug = await ensureUniqueSlug("categories", slugify(newCategory));
  const { data, error } = await db
    .from("categories")
    .insert({ name: newCategory, slug, is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function uploadImages(productId: string, files: File[]) {
  const storage = adminStorage();
  const uploaded: Array<{ storage_key: string; sort_order: number }> = [];
  for (const [index, file] of files.entries()) {
    const extension = IMAGE_EXTENSIONS[file.type];
    if (!extension) continue;
    const key = `${productId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await storage.from(PRODUCT_IMAGE_BUCKET).upload(key, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    uploaded.push({ storage_key: key, sort_order: index });
  }
  return uploaded;
}

function collectImageFiles(formData: FormData) {
  return formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

export async function createProductAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const kind = (String(formData.get("productKind") ?? "SIMPLE") as ProductKind) ?? "SIMPLE";
    if (!["SIMPLE", "VARIANTS", "MEASURED"].includes(kind)) return failure("Tipo de producto no válido.");

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return failure("El nombre del producto es obligatorio.");
    if (name.length > 140) return failure("El nombre no puede exceder 140 caracteres.");

    const taxRate = Number(String(formData.get("taxRate") ?? "0").replace(",", ".")) || 0;
    if (taxRate < 0 || taxRate > 100) return failure("El impuesto base debe estar entre 0 y 100.");

    const files = collectImageFiles(formData);
    if (files.length > MAX_PRODUCT_IMAGES) return failure(`Puedes subir un máximo de ${MAX_PRODUCT_IMAGES} imágenes.`);
    for (const file of files) {
      if (!IMAGE_EXTENSIONS[file.type]) return failure("Solo se admiten imágenes JPG, PNG, WEBP o AVIF.");
      if (file.size > MAX_IMAGE_BYTES) return failure("Cada imagen debe pesar 5 MB o menos.");
    }

    const parsed = parseVariants(formData, kind);
    if (parsed.error) return failure(parsed.error);

    const db = adminDb();
    const categoryId = await resolveCategoryId(formData);
    const slug = await ensureUniqueSlug("products", slugify(name));
    const catalogType = String(formData.get("catalogType") ?? "IMMEDIATE") === "ON_DEMAND" ? "ON_DEMAND" : "IMMEDIATE";

    const weeklyPlanEligible = formData.get("weeklyPlanEligible") === "on";
    const inTransit = readInTransit(formData, catalogType);
    const productFields = {
      name,
      slug,
      description: String(formData.get("description") ?? "").trim() || null,
      internal_code: String(formData.get("internalCode") ?? "").trim() || null,
      category_id: categoryId,
      catalog_type: catalogType,
      product_kind: kind,
      tax_rate_percent: taxRate,
      is_public: formData.get("isPublic") === "on",
      is_active: true,
      created_by_admin_id: actor.id,
    };

    const { result: insertResult, warning: migrationWarning, blocked } = await writeWithOptionalColumns(
      (optionalFields) =>
        db
          .from("products")
          .insert({ ...productFields, ...optionalFields })
          .select("id")
          .single(),
      optionalProductColumns(weeklyPlanEligible, inTransit),
    );
    if (blocked) return failure(blocked);
    const { data: product, error: productError } = insertResult;
    if (productError) return failure(describeError(new Error(productError.message), "No fue posible crear el producto."));

    const productId = product.id as string;

    const { data: variantRows, error: variantError } = await db
      .from("product_variants")
      .insert(
        parsed.variants.map((variant) => ({
          product_id: productId,
          name: variant.name,
          sku: variant.sku,
          barcode: variant.barcode,
          unit_label: variant.unitLabel,
          price_cents: variant.priceCents,
          cost_cents: variant.costCents,
          min_quantity: variant.minQuantity,
          attributes: variant.attributes,
          is_active: true,
        })),
      )
      .select("id, name");
    if (variantError) {
      await db.from("products").delete().eq("id", productId);
      return failure(describeError(new Error(variantError.message), "No fue posible crear las variantes."));
    }

    // Opening stock enters through the same ledger every other movement uses.
    const movements = (variantRows ?? [])
      .map((row, index) => ({
        variant_id: row.id as string,
        movement_type: "RECEIPT" as const,
        quantity_delta: parsed.variants[index]?.quantity ?? 0,
        reason: "Existencia inicial al crear el producto",
        created_by_admin_id: actor.id,
      }))
      .filter((movement) => movement.quantity_delta > 0);
    if (movements.length) {
      const { error: movementError } = await db.from("inventory_movements").insert(movements);
      if (movementError) {
        return failure(
          `El producto se creó, pero no fue posible registrar la existencia inicial: ${movementError.message}`,
        );
      }
    }

    let imageWarning = "";
    if (files.length) {
      try {
        const uploaded = await uploadImages(productId, files);
        if (uploaded.length) {
          const { error: imageError } = await db
            .from("product_images")
            .insert(uploaded.map((image) => ({ ...image, product_id: productId })));
          if (imageError) imageWarning = " Las imágenes se subieron pero no quedaron asociadas.";
        }
      } catch (error) {
        imageWarning = ` No fue posible subir las imágenes (${
          error instanceof Error ? error.message : "error de almacenamiento"
        }).`;
      }
    }

    await logActivity({
      adminUserId: actor.id,
      action: "PRODUCT_CREATED",
      entityType: "products",
      entityId: productId,
      newData: { name, slug, kind, variants: parsed.variants.length, catalog_type: catalogType, in_transit: inTransit },
    });
    revalidateCatalog();
    return ok(`Producto "${name}" creado.${imageWarning}${migrationWarning}`);
  } catch (error) {
    return failure(describeError(error, "No fue posible crear el producto."));
  }
}

export async function updateProductAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    if (!id) return failure("Producto no encontrado.");

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return failure("El nombre del producto es obligatorio.");

    const taxRate = Number(String(formData.get("taxRate") ?? "0").replace(",", ".")) || 0;
    if (taxRate < 0 || taxRate > 100) return failure("El impuesto base debe estar entre 0 y 100.");

    const db = adminDb();
    const { data: previous, error: previousError } = await db
      .from("products")
      .select("id, name, slug, is_public, category_id, tax_rate_percent, product_kind")
      .eq("id", id)
      .maybeSingle();
    if (previousError) return failure(describeError(new Error(previousError.message), "No fue posible leer el producto."));
    if (!previous) return failure("El producto ya no existe.");

    const categoryId = await resolveCategoryId(formData);
    const slug =
      previous.name === name ? previous.slug : await ensureUniqueSlug("products", slugify(name), id);

    const weeklyPlanEligible = formData.get("weeklyPlanEligible") === "on";
    const catalogType = String(formData.get("catalogType") ?? "IMMEDIATE") === "ON_DEMAND" ? "ON_DEMAND" : "IMMEDIATE";
    const inTransit = readInTransit(formData, catalogType);
    const productUpdate = {
      name,
      slug,
      description: String(formData.get("description") ?? "").trim() || null,
      internal_code: String(formData.get("internalCode") ?? "").trim() || null,
      category_id: categoryId,
      catalog_type: catalogType,
      tax_rate_percent: taxRate,
      is_public: formData.get("isPublic") === "on",
      updated_at: new Date().toISOString(),
    };

    const { result: updateResult, warning: migrationWarning, blocked } = await writeWithOptionalColumns(
      (optionalFields) =>
        db
          .from("products")
          .update({ ...productUpdate, ...optionalFields })
          .eq("id", id),
      optionalProductColumns(weeklyPlanEligible, inTransit),
    );
    if (blocked) return failure(blocked);
    const { error } = updateResult;
    if (error) return failure(describeError(new Error(error.message), "No fue posible actualizar el producto."));

    // Per-variant commercial data (price / cost / minimum) is editable here;
    // stock itself is never edited in place, it only moves through the ledger.
    const variantIds = formData.getAll("variantId").map((value) => String(value));
    for (const [index, variantId] of variantIds.entries()) {
      if (!variantId) continue;
      const priceCents = parseMoneyToCents(formData.getAll("variantPrice")[index] ?? "");
      const costCents = parseMoneyToCents(formData.getAll("variantCost")[index] ?? "") ?? 0;
      const minQuantity = parseQuantity(formData.getAll("variantMinQuantity")[index] ?? "") ?? 0;
      if (priceCents === null || priceCents < 0 || costCents < 0 || minQuantity < 0) {
        return failure("Revisa los precios, costos y mínimos de las variantes.");
      }
      const variantName = String(formData.getAll("variantName")[index] ?? "").trim();
      const { error: variantError } = await db
        .from("product_variants")
        .update({
          name: variantName || undefined,
          price_cents: priceCents,
          cost_cents: costCents,
          min_quantity: minQuantity,
          updated_at: new Date().toISOString(),
        })
        .eq("id", variantId)
        .eq("product_id", id);
      if (variantError) {
        return failure(describeError(new Error(variantError.message), "No fue posible actualizar una variante."));
      }
    }

    let imageWarning = "";
    const files = collectImageFiles(formData);
    if (files.length) {
      const { count } = await db
        .from("product_images")
        .select("id", { count: "exact", head: true })
        .eq("product_id", id);
      const existing = count ?? 0;
      if (existing + files.length > MAX_PRODUCT_IMAGES) {
        imageWarning = ` No se agregaron imágenes: el máximo es ${MAX_PRODUCT_IMAGES} por producto.`;
      } else {
        try {
          const uploaded = await uploadImages(id, files);
          if (uploaded.length) {
            await db
              .from("product_images")
              .insert(uploaded.map((image, index) => ({ ...image, sort_order: existing + index, product_id: id })));
          }
        } catch (uploadError) {
          imageWarning = ` No fue posible subir las imágenes (${
            uploadError instanceof Error ? uploadError.message : "error de almacenamiento"
          }).`;
        }
      }
    }

    await logActivity({
      adminUserId: actor.id,
      action: "PRODUCT_UPDATED",
      entityType: "products",
      entityId: id,
      previousData: previous,
      newData: { name, slug, category_id: categoryId, tax_rate_percent: taxRate, catalog_type: catalogType, in_transit: inTransit },
    });
    revalidateCatalog();
    revalidatePath(`/admin/productos/${id}`);
    return ok(`Producto actualizado.${imageWarning}${migrationWarning}`);
  } catch (error) {
    return failure(describeError(error, "No fue posible actualizar el producto."));
  }
}

export async function setProductActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const active = String(formData.get("active") ?? "") === "true";
    if (!id) return failure("Producto no encontrado.");

    const db = adminDb();
    const { error } = await db
      .from("products")
      .update({ is_active: active, is_public: active ? undefined : false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return failure(describeError(new Error(error.message), "No fue posible archivar el producto."));

    await logActivity({
      adminUserId: actor.id,
      action: active ? "PRODUCT_RESTORED" : "PRODUCT_ARCHIVED",
      entityType: "products",
      entityId: id,
      newData: { is_active: active },
    });
    revalidateCatalog();
    return ok(active ? "Producto restaurado." : "Producto archivado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible archivar el producto."));
  }
}

export async function bulkArchiveProductsAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const ids = formData.getAll("id").map((value) => String(value)).filter(Boolean);
    if (!ids.length) return failure("Selecciona al menos un producto.");

    const db = adminDb();
    const { error } = await db
      .from("products")
      .update({ is_active: false, is_public: false, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) return failure(describeError(new Error(error.message), "No fue posible archivar los productos."));

    await logActivity({
      adminUserId: actor.id,
      action: "PRODUCT_BULK_ARCHIVED",
      entityType: "products",
      entityId: ids.join(","),
      newData: { count: ids.length },
    });
    revalidateCatalog();
    return ok(`${ids.length} producto(s) archivado(s).`);
  } catch (error) {
    return failure(describeError(error, "No fue posible archivar los productos."));
  }
}

/**
 * Images are not copied: product_images.storage_key is UNIQUE, so duplicating
 * them would mean copying the actual file in Storage. Simpler and honest to
 * leave the copy without photos — the admin re-adds them if needed — than to
 * silently do extra storage work or reuse the same image across two products.
 * Stock also starts at zero; a duplicate is a new product, not new inventory.
 */
export async function duplicateProductAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    if (!id) return failure("Producto no encontrado.");

    const db = adminDb();
    const { data: source, error: sourceError } = await db
      .from("products")
      .select(
        `name, description, category_id, catalog_type, product_kind, tax_rate_percent,
         product_variants(name, sku, barcode, unit_label, price_cents, cost_cents, min_quantity, attributes, is_active)`,
      )
      .eq("id", id)
      .maybeSingle();
    if (sourceError) return failure(describeError(new Error(sourceError.message), "No fue posible leer el producto."));
    if (!source) return failure("El producto ya no existe.");

    const newName = `${source.name} (copia)`;
    const slug = await ensureUniqueSlug("products", slugify(newName));
    const { data: created, error: createError } = await db
      .from("products")
      .insert({
        name: newName,
        slug,
        description: source.description,
        category_id: source.category_id,
        catalog_type: source.catalog_type,
        product_kind: source.product_kind,
        tax_rate_percent: source.tax_rate_percent,
        is_public: false,
        is_active: true,
        created_by_admin_id: actor.id,
      })
      .select("id")
      .single();
    if (createError) return failure(describeError(new Error(createError.message), "No fue posible duplicar el producto."));

    const variants = (source.product_variants as VariantSourceRow[] | null ?? []).filter((v) => v.is_active);
    if (variants.length) {
      const { error: variantError } = await db.from("product_variants").insert(
        variants.map((variant) => ({
          product_id: created.id,
          name: variant.name,
          sku: null,
          barcode: null,
          unit_label: variant.unit_label,
          price_cents: variant.price_cents,
          cost_cents: variant.cost_cents,
          min_quantity: variant.min_quantity,
          attributes: variant.attributes,
          is_active: true,
        })),
      );
      if (variantError) {
        await db.from("products").delete().eq("id", created.id);
        return failure(describeError(new Error(variantError.message), "No fue posible duplicar las variantes."));
      }
    }

    await logActivity({
      adminUserId: actor.id,
      action: "PRODUCT_DUPLICATED",
      entityType: "products",
      entityId: created.id as string,
      previousData: { sourceId: id },
      newData: { name: newName },
    });
    revalidateCatalog();
    return ok(`"${newName}" se creó como borrador oculto, sin fotos ni existencias — agrégalas y márcalo visible cuando esté listo.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible duplicar el producto."));
  }
}

type VariantSourceRow = {
  name: string;
  sku: string | null;
  barcode: string | null;
  unit_label: string | null;
  price_cents: number;
  cost_cents: number;
  min_quantity: number;
  attributes: Record<string, unknown>;
  is_active: boolean;
};

export async function deleteProductImageAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const imageId = String(formData.get("imageId") ?? "");
    const productId = String(formData.get("productId") ?? "");
    if (!imageId || !productId) return failure("Imagen no encontrada.");

    const db = adminDb();
    const { data: image } = await db
      .from("product_images")
      .select("storage_key")
      .eq("id", imageId)
      .eq("product_id", productId)
      .maybeSingle();

    const { error } = await db.from("product_images").delete().eq("id", imageId).eq("product_id", productId);
    if (error) return failure(describeError(new Error(error.message), "No fue posible eliminar la imagen."));
    if (image?.storage_key) {
      await adminStorage().from(PRODUCT_IMAGE_BUCKET).remove([image.storage_key as string]);
    }

    await logActivity({
      adminUserId: actor.id,
      action: "PRODUCT_IMAGE_DELETED",
      entityType: "product_images",
      entityId: imageId,
    });
    revalidateCatalog();
    revalidatePath(`/admin/productos/${productId}`);
    return ok("Imagen eliminada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible eliminar la imagen."));
  }
}

/**
 * Inline Stock / Precio / Costo tienda inputs of the Productos lists. Only
 * checks the session and parses the field; the rules (price in cents, stock as
 * a ledger adjustment computed against the stock read at save time, peso cost
 * calculated from the USD cost with the settings read at save time) live in
 * updateVariantQuick.
 */
export async function updateVariantQuickAction(_state: ActionState, formData: FormData): Promise<StoreCostActionState> {
  try {
    const actor = await requireAdminActor();
    const variantId = String(formData.get("variantId") ?? "");
    const field = String(formData.get("field") ?? "");
    if (field !== "price" && field !== "stock" && field !== "store_cost" && field !== "commission") {
      return failure("Campo no válido.");
    }

    const raw = formData.get("value");
    let value: number | null;
    if (field === "store_cost") {
      value = parseUsdToCents(raw);
      if (value !== null && Number.isNaN(value)) return failure("Escribe un costo en dólares válido (por ejemplo 24.50).");
    } else if (field === "commission") {
      value = Number(String(raw ?? "").trim() || Number.NaN);
    } else {
      value = field === "price" ? parseMoneyToCents(raw) : parseQuantity(raw);
      if (value === null) return failure(field === "price" ? "Escribe un precio válido." : "Escribe una cantidad válida.");
    }

    const result = await updateVariantQuick({ variantId, field, value, adminId: actor.id });
    if (!result.ok) return failure(result.error);
    const variant = result.storeCost?.next;
    if (!result.changed) return { ...ok("Sin cambios."), variant };

    if (result.storeCost) {
      await logActivity({
        adminUserId: actor.id,
        action: "PRODUCT_COST_QUICK_EDIT",
        entityType: "product_variants",
        entityId: result.variantId,
        previousData: {
          store_cost_usd_cents: result.storeCost.previous.storeCostUsdCents,
          commission_percent: result.storeCost.previous.commissionPercent,
          cost_cents: result.storeCost.previous.costCents,
        },
        newData: {
          store_cost_usd_cents: result.storeCost.next.storeCostUsdCents,
          commission_percent: result.storeCost.next.commissionPercent,
          cost_cents: result.storeCost.next.costCents,
          usd_mxn_rate: result.storeCost.usdMxnRate,
          us_tax_factor: result.storeCost.taxFactor,
          productId: result.productId,
        },
      });
      revalidateCatalog();
      return {
        ...ok(
          field === "commission" ? "Comisión guardada." : variant?.storeCostUsdCents === null ? "Costo en USD borrado." : "Costo guardado.",
        ),
        variant,
      };
    }

    await logActivity({
      adminUserId: actor.id,
      action: field === "price" ? "PRODUCT_PRICE_QUICK_EDIT" : "INVENTORY_ADJUSTMENT",
      entityType: field === "price" ? "product_variants" : "inventory_movements",
      entityId: result.variantId,
      previousData: field === "price" ? { price_cents: result.previous } : { stock: result.previous },
      newData:
        field === "price"
          ? { price_cents: result.next, productId: result.productId }
          : { stock: result.next, quantityDelta: result.delta, reason: QUICK_STOCK_REASON, productId: result.productId },
    });
    revalidateCatalog();
    return ok(field === "price" ? "Precio guardado." : "Cantidad guardada.");
  } catch (error) {
    return failure(describeError(error, "No fue posible guardar el cambio."));
  }
}

/**
 * Tipo de cambio USD→MXN / Tax bar above the product lists. Saving a new rate
 * does not recalculate costs already saved (each is the cost at purchase time).
 */
export async function updateCostSettingAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const key = String(formData.get("key") ?? "");
    const result = await updateCostSetting({ key, value: formData.get("value"), adminId: actor.id });
    if (!result.ok) return failure(result.error);
    if (!result.changed) return ok("Sin cambios.");

    await logActivity({
      adminUserId: actor.id,
      action: "COST_SETTING_UPDATED",
      entityType: "app_settings",
      entityId: result.key,
      previousData: { value: result.previous },
      newData: { value: result.next },
    });
    revalidatePath("/admin/productos");
    revalidatePath("/admin/productos/entrega-inmediata");
    revalidatePath("/admin/productos/en-camino");
    revalidatePath("/admin/configuracion");
    return ok(result.key === "usd_mxn_rate" ? "Tipo de cambio guardado." : "Tax guardado.");
  } catch (error) {
    return failure(describeError(error, "No fue posible guardar el ajuste."));
  }
}

/** Visible / Oculto chip of the Catálogo column: one click shows or hides the product. */
export async function setProductPublicAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const isPublic = String(formData.get("public") ?? "") === "true";
    const result = await setProductPublic({ productId: id, isPublic });
    if (!result.ok) return failure(result.error);
    if (!result.changed) return ok(result.next ? "Ya estaba visible." : "Ya estaba oculto.");

    await logActivity({
      adminUserId: actor.id,
      action: result.next ? "PRODUCT_PUBLISHED" : "PRODUCT_HIDDEN",
      entityType: "products",
      entityId: id,
      previousData: { is_public: result.previous },
      newData: { is_public: result.next },
    });
    revalidateCatalog();
    revalidatePath(`/admin/productos/${id}`);
    return ok(result.next ? `"${result.name}" ya es visible en el catálogo.` : `"${result.name}" quedó oculto.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible cambiar la visibilidad."));
  }
}

/** "Marcar como recibido" on Productos en camino: the merchandise becomes Entrega inmediata stock. */
export async function markProductReceivedAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireAdminActor();
    const id = String(formData.get("id") ?? "");
    const result = await markProductReceived(id);
    if (!result.ok) return failure(result.error);

    await logActivity({
      adminUserId: actor.id,
      action: "PRODUCT_RECEIVED",
      entityType: "products",
      entityId: id,
      previousData: { in_transit: true },
      newData: { in_transit: false },
    });
    revalidateCatalog();
    revalidatePath(`/admin/productos/${id}`);
    return ok(`"${result.name}" pasó a Entrega inmediata.`);
  } catch (error) {
    return failure(describeError(error, "No fue posible marcar el producto como recibido."));
  }
}
