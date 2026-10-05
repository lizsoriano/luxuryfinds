"use client";

import { useActionState, useRef, useState, type DragEvent } from "react";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input, Select, Textarea } from "../../../components/ui/Fields";
import { emptyActionState } from "../../../lib/actions";
import { centsToInput, formatQuantity } from "../../../lib/format";
import { createProductAction, updateProductAction } from "./actions";
import { compressPhoto } from "../compras/compress-photo";

const MAX_IMAGES = 3;

type CategoryOption = { id: string; name: string };

type ExistingVariant = {
  id: string;
  name: string;
  sku: string | null;
  price_cents: number;
  cost_cents: number;
  /** Set when the cost was calculated from a US store cost (migration 009). */
  store_cost_usd_cents?: number | null;
  min_quantity: number;
  unit_label: string | null;
  stock: number;
};

export type EditableProduct = {
  id: string;
  name: string;
  description: string | null;
  internal_code: string | null;
  category_id: string | null;
  catalog_type: "ON_DEMAND" | "IMMEDIATE";
  product_kind: "SIMPLE" | "VARIANTS" | "MEASURED";
  tax_rate_percent: number;
  is_public: boolean;
  weekly_plan_eligible: boolean;
  in_transit: boolean;
  variants: ExistingVariant[];
};

type CatalogType = EditableProduct["catalog_type"];

const KINDS = [
  {
    value: "SIMPLE" as const,
    title: "Producto básico",
    description: "Una sola presentación. Un precio, un costo y una existencia.",
  },
  {
    value: "VARIANTS" as const,
    title: "Producto con variantes",
    description: "Varias presentaciones (talla, color, modelo) con precio y stock propios.",
  },
  {
    value: "MEASURED" as const,
    title: "Producto con medidas",
    description: "Se vende por unidad de medida (kg, m, l) y admite cantidades con decimales.",
  },
];

function ImagePicker({ remaining }: { remaining: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Array<{ name: string; url: string }>>([]);
  const [dragging, setDragging] = useState(false);

  const syncFromInput = () => {
    const files = Array.from(inputRef.current?.files ?? []);
    setPreviews((current) => {
      current.forEach((preview) => URL.revokeObjectURL(preview.url));
      return files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    });
  };

  const applyFiles = (files: File[]) => {
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    files.slice(0, remaining).forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    syncFromInput();
  };

  const handleChange = () => {
    const input = inputRef.current;
    if (!input) return;
    applyFiles(Array.from(input.files ?? []));
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (remaining <= 0) return;
    const dropped = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (dropped.length) applyFiles(dropped);
  };

  const removeAt = (index: number) => {
    const input = inputRef.current;
    if (!input) return;
    const files = Array.from(input.files ?? []);
    const transfer = new DataTransfer();
    files.forEach((file, position) => {
      if (position !== index) transfer.items.add(file);
    });
    input.files = transfer.files;
    syncFromInput();
  };

  return (
    <div className="field field-wide">
      <span>Imágenes (máximo {MAX_IMAGES})</span>
      <label
        className={`admin-dropzone${dragging ? " dragging" : ""}${remaining <= 0 ? " disabled" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (remaining > 0) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          name="images"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          onChange={handleChange}
          disabled={remaining <= 0}
        />
        <span>{dragging ? "Suelta para agregar" : "Arrastra tus imágenes aquí o haz clic para elegirlas"}</span>
      </label>
      <p className="admin-hint">
        {remaining <= 0
          ? `Este producto ya tiene ${MAX_IMAGES} imágenes. Elimina alguna para subir otra.`
          : `Puedes agregar ${remaining} imagen(es) más. JPG, PNG, WEBP o AVIF de hasta 5 MB cada una. Se reducen automáticamente antes de guardar.`}
      </p>
      {previews.length ? (
        <div className="admin-image-row">
          {previews.map((preview, index) => (
            <div className="admin-image-slot" key={preview.url}>
              <img src={preview.url} alt={preview.name} />
              <button
                type="button"
                className="admin-image-remove"
                aria-label={`Quitar ${preview.name}`}
                onClick={() => removeAt(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CategoryField({
  categories,
  defaultValue,
}: {
  categories: CategoryOption[];
  defaultValue?: string | null;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="field">
      <span>Categoría</span>
      {creating ? (
        <>
          <input className="input" name="newCategoryName" placeholder="Nombre de la nueva categoría" maxLength={80} />
          <button
            type="button"
            className="admin-chip"
            style={{ marginTop: 8, width: "max-content" }}
            onClick={() => setCreating(false)}
          >
            Elegir una existente
          </button>
        </>
      ) : (
        <>
          <select className="input select" name="categoryId" defaultValue={defaultValue ?? ""}>
            <option value="">Sin categoría</option>
            {categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="admin-chip"
            style={{ marginTop: 8, width: "max-content" }}
            onClick={() => setCreating(true)}
          >
            + Crear categoría nueva
          </button>
        </>
      )}
    </div>
  );
}

function NewVariantRows() {
  const [rows, setRows] = useState([0, 1]);
  const nextId = useRef(2);

  return (
    <div className="field-wide">
      <p className="micro-label">VARIANTES</p>
      {rows.map((row, index) => (
        <div className="admin-variant-row" key={row}>
          <Input id={`variant-name-${row}`} name="variantName" label="Nombre" placeholder="Ej. Talla M" required={index === 0} />
          <Input id={`variant-sku-${row}`} name="variantSku" label="SKU" placeholder="Opcional" />
          <Input id={`variant-price-${row}`} name="variantPrice" label="Precio" type="number" min="0" step="0.01" required={index === 0} />
          <Input id={`variant-cost-${row}`} name="variantCost" label="Costo" type="number" min="0" step="0.01" defaultValue="0" />
          <Input id={`variant-qty-${row}`} name="variantQuantity" label="Existencia" type="number" min="0" step="1" defaultValue="0" />
          <Input id={`variant-min-${row}`} name="variantMinQuantity" label="Mínimo" type="number" min="0" step="1" defaultValue="0" />
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => setRows((current) => (current.length > 1 ? current.filter((value) => value !== row) : current))}
          >
            Quitar
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="small"
        onClick={() => {
          setRows((current) => [...current, nextId.current]);
          nextId.current += 1;
        }}
      >
        + Agregar variante
      </Button>
    </div>
  );
}

export function ProductForm({
  categories,
  product,
  existingImageCount = 0,
  defaults,
  backHref = "/admin/productos",
}: {
  categories: CategoryOption[];
  product?: EditableProduct;
  existingImageCount?: number;
  /** New products only: preselected from the list the admin came from. */
  defaults?: { catalogType: CatalogType; inTransit: boolean };
  /** The list this product belongs to (or the one the admin came from). */
  backHref?: string;
}) {
  const isEdit = Boolean(product);
  const [state, action, pending] = useActionState(
    async (previous: typeof emptyActionState, data: FormData) => {
      try {
        const images = data.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
        if (images.length > MAX_IMAGES - existingImageCount) return { ...emptyActionState, error: "Se excedió el máximo de imágenes." };
        if (images.some((image) => image.size > 5 * 1024 * 1024)) return { ...emptyActionState, error: "Cada imagen debe pesar como máximo 5 MB." };
        data.delete("images");
        // The budget is for the entire request, including all three photos.
        for (const image of images) data.append("images", await compressPhoto(image, Math.floor(800 * 1024 / images.length)));
        if ((await new Response(data).arrayBuffer()).byteLength > 950 * 1024) return { ...emptyActionState, error: "El formulario completo pesa demasiado. Reduce las imágenes o guarda menos variantes a la vez." };
        return await (isEdit ? updateProductAction : createProductAction)(previous, data);
      } catch (error) {
        return { ...emptyActionState, error: error instanceof Error ? error.message : "No pudimos preparar las fotos." };
      }
    },
    emptyActionState,
  );
  const [kind, setKind] = useState<EditableProduct["product_kind"]>(product?.product_kind ?? "SIMPLE");
  const [catalogType, setCatalogType] = useState<CatalogType>(
    product?.catalog_type ?? defaults?.catalogType ?? "IMMEDIATE",
  );
  const firstVariant = product?.variants[0];

  return (
    <form action={action} noValidate={false}>
      {isEdit ? <input type="hidden" name="id" value={product?.id} /> : null}
      <input type="hidden" name="productKind" value={kind} />

      {isEdit ? (
        <p className="admin-hint" style={{ marginBottom: 18 }}>
          Tipo de producto: <Badge tone="rose">{KINDS.find((option) => option.value === kind)?.title}</Badge>{" "}
          El tipo no se cambia después de crear el producto para no romper el historial de inventario.
        </p>
      ) : (
        <div className="admin-kind-picker">
          {KINDS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`admin-kind-option${kind === option.value ? " active" : ""}`}
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
            >
              <strong>{option.title}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      )}

      <Card className="admin-panel">
        <div className="admin-form-grid">
          <ImagePicker remaining={Math.max(0, MAX_IMAGES - existingImageCount)} />

          <Input
            id="product-name"
            name="name"
            label="Nombre del producto *"
            defaultValue={product?.name ?? ""}
            maxLength={140}
            required
          />
          <Input
            id="product-code"
            name="internalCode"
            label="Código interno / SKU"
            defaultValue={product?.internal_code ?? firstVariant?.sku ?? ""}
            placeholder="Opcional"
          />

          {kind === "VARIANTS" && !isEdit ? (
            <NewVariantRows />
          ) : isEdit ? null : (
            <>
              <Input
                id="product-price"
                name="price"
                label="Precio de venta *"
                type="number"
                min="0"
                step="0.01"
                required
              />
              <Input id="product-cost" name="cost" label="Costo" type="number" min="0" step="0.01" defaultValue="0" />
              <Input
                id="product-quantity"
                name="quantity"
                label="Cantidad disponible inicial"
                type="number"
                min="0"
                step={kind === "MEASURED" ? "0.001" : "1"}
                defaultValue="0"
              />
              <Input
                id="product-min-quantity"
                name="minQuantity"
                label="Cantidad mínima (alerta de stock bajo)"
                type="number"
                min="0"
                step={kind === "MEASURED" ? "0.001" : "1"}
                defaultValue="0"
              />
              {kind === "MEASURED" ? (
                <Input
                  id="product-unit"
                  name="unitLabel"
                  label="Unidad de medida *"
                  placeholder="kg, m, l, pza"
                  required
                  maxLength={12}
                />
              ) : (
                <Input id="product-barcode" name="barcode" label="Código de barras" placeholder="Opcional" />
              )}
            </>
          )}

          <CategoryField categories={categories} defaultValue={product?.category_id ?? null} />

          <Select
            id="product-catalog-type"
            name="catalogType"
            label="Disponibilidad"
            value={catalogType}
            onChange={(event) => setCatalogType(event.target.value === "ON_DEMAND" ? "ON_DEMAND" : "IMMEDIATE")}
          >
            <option value="IMMEDIATE">Entrega inmediata</option>
            <option value="ON_DEMAND">Por pedido</option>
          </Select>

          <Input
            id="product-tax"
            name="taxRate"
            label="Impuesto base (%)"
            type="number"
            min="0"
            max="100"
            step="0.001"
            defaultValue={String(product?.tax_rate_percent ?? 0)}
          />

          <Textarea
            id="product-description"
            name="description"
            label="Descripción"
            rows={4}
            className="input textarea"
            defaultValue={product?.description ?? ""}
          />

          <label className="admin-switch field-wide" htmlFor="product-public">
            <input
              id="product-public"
              type="checkbox"
              name="isPublic"
              defaultChecked={product?.is_public ?? false}
            />
            <span>
              Mostrar en el catálogo virtual
              <small>
                Al activarlo el producto aparece en el sitio público (/catalogo). Al desactivarlo solo existe
                para el inventario y el punto de venta.
              </small>
            </span>
          </label>

          <label className="admin-switch field-wide" htmlFor="product-weekly-plan">
            <input
              id="product-weekly-plan"
              type="checkbox"
              name="weeklyPlanEligible"
              defaultChecked={product?.weekly_plan_eligible ?? false}
            />
            <span>
              Admite plan de pago semanal
              <small>
                Al activarlo, cualquier clienta puede elegir pagarlo en semanas (4 a 16) desde el checkout, en
                vez de pago completo. Requiere database/migrations/004_weekly_plan_checkout.sql aplicada en Supabase.
              </small>
            </span>
          </label>

          {catalogType === "IMMEDIATE" ? (
            <label className="admin-switch field-wide" htmlFor="product-in-transit">
              <input
                id="product-in-transit"
                type="checkbox"
                name="inTransit"
                defaultChecked={product?.in_transit ?? defaults?.inTransit ?? false}
              />
              <span>
                Viene en camino (ya lo pedí)
                <small>
                  Mercancía que ya compraste y todavía no llega a la tienda. Aparece en Inventario › Productos en
                  camino y no se puede vender (ni en Vender ni en el sitio) hasta que la marques como recibida.
                  Requiere database/migrations/008_products_in_transit.sql aplicada en Supabase.
                </small>
              </span>
            </label>
          ) : null}

          {isEdit && product ? (
            <div className="field-wide">
              <p className="micro-label">PRECIOS Y EXISTENCIAS POR VARIANTE</p>
              <p className="admin-hint" style={{ marginBottom: 6 }}>
                La existencia no se edita aquí: se mueve con entradas y salidas de inventario, para que el
                historial siga siendo auditable.
              </p>
              {product.variants.map((variant) => (
                <div className="admin-variant-row" key={variant.id}>
                  <input type="hidden" name="variantId" value={variant.id} />
                  <Input
                    id={`variant-name-${variant.id}`}
                    name="variantName"
                    label="Nombre"
                    defaultValue={variant.name}
                    required
                  />
                  <Input
                    id={`variant-price-${variant.id}`}
                    name="variantPrice"
                    label="Precio"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={centsToInput(variant.price_cents)}
                    required
                  />
                  {variant.store_cost_usd_cents !== null && variant.store_cost_usd_cents !== undefined ? (
                    // Calculated from the USD cost in the Productos list: read-only here
                    // so the two never disagree (the same value is posted back).
                    <label className="field" htmlFor={`variant-cost-${variant.id}`}>
                      <span>
                        Costo <small className="admin-field-note">calculado desde el costo en USD</small>
                      </span>
                      <input
                        className="input input-computed"
                        id={`variant-cost-${variant.id}`}
                        name="variantCost"
                        type="number"
                        min="0"
                        step="0.01"
                        readOnly
                        title={`Calculado desde US$${centsToInput(variant.store_cost_usd_cents)}. Cámbialo desde la lista de productos.`}
                        defaultValue={centsToInput(variant.cost_cents)}
                      />
                    </label>
                  ) : (
                    <Input
                      id={`variant-cost-${variant.id}`}
                      name="variantCost"
                      label="Costo"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={centsToInput(variant.cost_cents)}
                    />
                  )}
                  <Input
                    id={`variant-min-${variant.id}`}
                    name="variantMinQuantity"
                    label="Mínimo"
                    type="number"
                    min="0"
                    step="0.001"
                    defaultValue={String(variant.min_quantity)}
                  />
                  <div className="field">
                    <span>Existencia</span>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
                      {formatQuantity(variant.stock, variant.unit_label)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {state.error && (
            <p className="form-message form-error field-wide" role="alert">
              {state.error}
            </p>
          )}
          {state.success && (
            <p className="form-message form-success field-wide" role="status">
              {state.success}
            </p>
          )}

          <div className="admin-form-actions">
            <Button href={backHref} variant="secondary" size="small">
              Volver al listado
            </Button>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear producto"}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
