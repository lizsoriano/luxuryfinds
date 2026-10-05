"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { centsToInput } from "../../../lib/format";
import { FormMessage, PhotoField, useActionForm, usePhoto } from "../../admin/compras/form-kit";
import {
  addStaffPhotoAction,
  createStaffProductAction,
  recordStaffEntryAction,
  updateStaffPriceAction,
  type StaffActionState,
} from "../actions";

// Phone-first forms of "Inventario en La Paz". Photos go through the same
// in-browser compression as Compras con shopper (~1600 px JPEG ≤ ~850 KB): a
// server action body is capped at 1 MB. Only SALE prices are ever typed here.

type VariantDraft = { key: number; name: string; price: string; quantity: string };

export function NewProductForm({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const photo = usePhoto();
  const [variants, setVariants] = useState<VariantDraft[]>([{ key: 1, name: "Único", price: "", quantity: "1" }]);
  const { state, pending, onSubmit } = useActionForm<StaffActionState>(createStaffProductAction, {
    prepare: photo.attach,
    onSuccess: (next) => {
      if (next.productId) router.push(`/empleado/inventario/${next.productId}`);
    },
  });

  const update = (key: number, field: keyof Omit<VariantDraft, "key">, value: string) =>
    setVariants((current) => current.map((variant) => (variant.key === key ? { ...variant, [field]: value } : variant)));

  return (
    <form className="staff-form" onSubmit={onSubmit}>
      <label className="field" htmlFor="staff-product-name">
        <span>Nombre del producto *</span>
        <input id="staff-product-name" className="input" name="name" required maxLength={140} placeholder="Ej. Perfume Bloom 50 ml" />
      </label>

      <label className="field" htmlFor="staff-product-category">
        <span>Categoría</span>
        <select id="staff-product-category" className="input select" name="categoryId" defaultValue="">
          <option value="">Sin categoría</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="staff-fieldset">
        <legend>Variantes, precio de venta y cantidad que entra</legend>
        <p className="staff-hint">
          Si el producto no tiene variantes deja una sola fila llamada “Único”. Si tiene (tono, tamaño…), agrega una fila por
          cada una.
        </p>
        {variants.map((variant, index) => (
          <div className="staff-variant-row" key={variant.key}>
            <label className="field" htmlFor={`staff-variant-name-${variant.key}`}>
              <span>Variante *</span>
              <input
                id={`staff-variant-name-${variant.key}`}
                className="input"
                name="variantName"
                required
                value={variant.name}
                onChange={(event) => update(variant.key, "name", event.target.value)}
              />
            </label>
            <label className="field" htmlFor={`staff-variant-price-${variant.key}`}>
              <span>Precio de venta *</span>
              <input
                id={`staff-variant-price-${variant.key}`}
                className="input"
                name="variantPrice"
                inputMode="decimal"
                required
                placeholder="$0.00"
                value={variant.price}
                onChange={(event) => update(variant.key, "price", event.target.value)}
              />
            </label>
            <label className="field" htmlFor={`staff-variant-qty-${variant.key}`}>
              <span>Cantidad</span>
              <input
                id={`staff-variant-qty-${variant.key}`}
                className="input"
                name="variantQuantity"
                inputMode="numeric"
                pattern="[0-9]*"
                value={variant.quantity}
                onChange={(event) => update(variant.key, "quantity", event.target.value)}
              />
            </label>
            {variants.length > 1 ? (
              <button
                type="button"
                className="staff-link-button"
                onClick={() => setVariants((current) => current.filter((item) => item.key !== variant.key))}
                aria-label={`Quitar la variante ${index + 1}`}
              >
                Quitar
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="button button-secondary"
          onClick={() =>
            setVariants((current) => [
              ...current.map((item) => (current.length === 1 && item.name === "Único" ? { ...item, name: "" } : item)),
              { key: Math.max(...current.map((item) => item.key)) + 1, name: "", price: "", quantity: "1" },
            ])
          }
        >
          + Agregar variante
        </button>
      </fieldset>

      <PhotoField idPrefix="staff-product-photo" label="Foto del producto" state={photo} hint="Opcional. Puedes agregar hasta 3 desde la ficha del producto." />

      <div className="staff-note">
        El producto queda <strong>oculto</strong> en la tienda en línea hasta que la dueña lo revise y lo publique. Aquí solo
        se captura el precio de venta.
      </div>

      <FormMessage state={state} />
      <button type="submit" className="button button-primary button-full" disabled={pending || photo.busy}>
        {pending ? "Guardando…" : "Guardar producto"}
      </button>
    </form>
  );
}

export function EntryForm({
  variants,
  allowsDecimal,
  evidenceAvailable,
}: {
  variants: Array<{ id: string; name: string; stock: number }>;
  allowsDecimal: boolean;
  evidenceAvailable: boolean;
}) {
  const photo = usePhoto();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const { state, pending, onSubmit } = useActionForm<StaffActionState>(recordStaffEntryAction, {
    prepare: photo.attach,
    onSuccess: (_next, form) => {
      form.reset();
      photo.clear();
    },
  });
  const single = variants.length === 1;

  return (
    <form className="staff-form" onSubmit={onSubmit}>
      {single ? (
        <input type="hidden" name="variantId" value={variants[0].id} />
      ) : (
        <label className="field" htmlFor="staff-entry-variant">
          <span>Variante *</span>
          <select id="staff-entry-variant" className="input select" name="variantId" value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name} · hay {variant.stock}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field" htmlFor="staff-entry-quantity">
        <span>Cantidad que entra *</span>
        <input
          id="staff-entry-quantity"
          className="input"
          name="quantity"
          required
          inputMode={allowsDecimal ? "decimal" : "numeric"}
          pattern={allowsDecimal ? "[0-9]+([.,][0-9]{1,3})?" : "[0-9]*"}
          placeholder={allowsDecimal ? "Ej. 1.5" : "Ej. 3"}
        />
      </label>
      <PhotoField
        idPrefix="staff-entry-photo"
        label="Foto de lo que llegó"
        state={photo}
        hint={evidenceAvailable ? "Opcional, recomendada." : "La foto se podrá guardar cuando la dueña active la migración 013."}
      />
      <label className="field" htmlFor="staff-entry-note">
        <span>Nota</span>
        <input id="staff-entry-note" className="input" name="note" maxLength={300} placeholder="Ej. Llegó caja sellada, folio 123" />
      </label>
      <FormMessage state={state} />
      <button type="submit" className="button button-primary button-full" disabled={pending || photo.busy}>
        {pending ? "Registrando…" : "Registrar entrada"}
      </button>
    </form>
  );
}

export function PriceForm({ variantId, variantName, priceCents }: { variantId: string; variantName: string; priceCents: number }) {
  const { state, pending, onSubmit } = useActionForm<StaffActionState>(updateStaffPriceAction);
  return (
    <form className="staff-inline-form" onSubmit={onSubmit}>
      <input type="hidden" name="variantId" value={variantId} />
      <label className="field" htmlFor={`staff-price-${variantId}`}>
        <span>Precio de venta · {variantName}</span>
        <input id={`staff-price-${variantId}`} className="input" name="price" inputMode="decimal" defaultValue={centsToInput(priceCents)} required />
      </label>
      <button type="submit" className="button button-secondary" disabled={pending}>
        {pending ? "…" : "Guardar"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}

export function AddPhotoForm({ productId }: { productId: string }) {
  const photo = usePhoto();
  const { state, pending, onSubmit } = useActionForm<StaffActionState>(addStaffPhotoAction, {
    prepare: photo.attach,
    onSuccess: () => photo.clear(),
  });
  return (
    <form className="staff-form" onSubmit={onSubmit}>
      <input type="hidden" name="productId" value={productId} />
      <PhotoField idPrefix="staff-add-photo" label="Agregar foto" state={photo} />
      <FormMessage state={state} />
      <button type="submit" className="button button-secondary button-full" disabled={pending || photo.busy || !photo.photo}>
        {pending ? "Subiendo…" : "Guardar foto"}
      </button>
    </form>
  );
}
