"use client";

import { useActionState, useRef, useState } from "react";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input, Select, Textarea } from "../../../components/ui/Fields";
import { emptyActionState } from "../../../lib/actions";
import { formatQuantity } from "../../../lib/format";
import { createProductAction, updateProductAction } from "./actions";

const MAX_IMAGES = 3;

type CategoryOption = { id: string; name: string };

type ExistingVariant = {
  id: string;
  name: string;
  sku: string | null;
  price_cents: number;
  cost_cents: number;
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
  variants: ExistingVariant[];
};

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

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

function ImagePicker({ remaining }: { remaining: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Array<{ name: string; url: string }>>([]);

  const syncFromInput = () => {
    const files = Array.from(inputRef.current?.files ?? []);
    setPreviews((current) => {
      current.forEach((preview) => URL.revokeObjectURL(preview.url));
      return files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    });
  };

  const handleChange = () => {
    const input = inputRef.current;
    if (!input) return;
    const files = Array.from(input.files ?? []);
    if (files.length > remaining) {
      const transfer = new DataTransfer();
      files.slice(0, remaining).forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
    }
    syncFromInput();
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
      <input
        ref={inputRef}
        className="input"
        type="file"
        name="images"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        onChange={handleChange}
        disabled={remaining <= 0}
      />
      <p className="admin-hint">
        {remaining <= 0
          ? `Este producto ya tiene ${MAX_IMAGES} imágenes. Elimina alguna para subir otra.`
          : `Puedes agregar ${remaining} imagen(es) más. JPG, PNG, WEBP o AVIF de hasta 5 MB cada una.`}
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
}: {
  categories: CategoryOption[];
  product?: EditableProduct;
  existingImageCount?: number;
}) {
  const isEdit = Boolean(product);
  const [state, action, pending] = useActionState(
    isEdit ? updateProductAction : createProductAction,
    emptyActionState,
  );
  const [kind, setKind] = useState<EditableProduct["product_kind"]>(product?.product_kind ?? "SIMPLE");
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
            defaultValue={product?.catalog_type ?? "IMMEDIATE"}
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
            step="0.01"
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
                    defaultValue={money(variant.price_cents)}
                    required
                  />
                  <Input
                    id={`variant-cost-${variant.id}`}
                    name="variantCost"
                    label="Costo"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={money(variant.cost_cents)}
                  />
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
            <Button href="/admin/productos" variant="secondary" size="small">
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
