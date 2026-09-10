"use server";

import { revalidatePath } from "next/cache";
import { describeError, failure, ok, type ActionState } from "../../../lib/actions";
import { parseMoneyToCents, parseQuantity, slugify } from "../../../lib/format";
import { ensureUniqueSlug } from "../../../lib/supabase/admin-catalog";
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

function revalidateCatalog() {
  revalidatePath("/admin/productos");
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

    const { data: product, error: productError } = await db
      .from("products")
      .insert({
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
      })
      .select("id")
      .single();
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
      newData: { name, slug, kind, variants: parsed.variants.length },
    });
    revalidateCatalog();
    return ok(`Producto "${name}" creado.${imageWarning}`);
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

    const { error } = await db
      .from("products")
      .update({
        name,
        slug,
        description: String(formData.get("description") ?? "").trim() || null,
        internal_code: String(formData.get("internalCode") ?? "").trim() || null,
        category_id: categoryId,
        catalog_type: String(formData.get("catalogType") ?? "IMMEDIATE") === "ON_DEMAND" ? "ON_DEMAND" : "IMMEDIATE",
        tax_rate_percent: taxRate,
        is_public: formData.get("isPublic") === "on",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
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
      newData: { name, slug, category_id: categoryId, tax_rate_percent: taxRate },
    });
    revalidateCatalog();
    revalidatePath(`/admin/productos/${id}`);
    return ok(`Producto actualizado.${imageWarning}`);
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
