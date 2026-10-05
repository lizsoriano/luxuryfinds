import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime, formatMoney, formatQuantity } from "../../../../lib/format";
import { MAX_PRODUCT_IMAGES } from "../../../../lib/supabase/business";
import { getStaffSession } from "../../../../lib/supabase/auth";
import { getStaffProduct, listStaffCategories } from "../../../../lib/supabase/staff-inventory";
import { AddPhotoForm, EntryForm, EditProductForm, EditVariantForm } from "../InventoryForms";

export const dynamic = "force-dynamic";

const MOVEMENT_LABELS: Record<string, string> = {
  RECEIPT: "Entrada",
  ALLOCATION: "Apartado / venta",
  RELEASE: "Liberado",
  CANCELLATION: "Cancelación",
  DELIVERY: "Entregado",
  MANUAL_ADJUSTMENT: "Ajuste",
};

export default async function StaffProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getStaffSession();
  if (session.kind !== "authorized") notFound();

  let product;
  try {
    product = await getStaffProduct(id, session.staff.id);
  } catch (error) {
    return (
      <main className="staff-content">
        <p className="form-message form-error" role="alert">
          No pudimos cargar el producto: {error instanceof Error ? error.message : "error desconocido"}
        </p>
      </main>
    );
  }
  if (!product) notFound();
  const categories = product.canEditPrices ? await listStaffCategories() : [];

  return (
    <main className="staff-content staff-narrow">
      <Link className="staff-back" href="/empleado/inventario">
        ← Inventario en La Paz
      </Link>

      <div className="staff-product-head">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="staff-product-photo" src={product.imageUrl} alt="" />
        ) : (
          <span className="staff-product-photo staff-thumb-empty" aria-hidden>
            LF
          </span>
        )}
        <div>
          <h1 className="staff-title">{product.name}</h1>
          <p className="staff-lead">
            {product.categoryName ?? "Sin categoría"} · {formatQuantity(product.stock)} en existencia
          </p>
          <span className={product.isPublic ? "badge badge-success" : "badge badge-warning"}>
            {product.isPublic ? "Visible en la tienda" : "Oculto: lo publica la dueña"}
          </span>
        </div>
      </div>

      {!product.isLaPaz ? (
        <div className="staff-note">Este producto todavía viene en camino. Las entradas se registran cuando la dueña lo marque como recibido.</div>
      ) : null}

      {product.canEditPrices && <section className="staff-card staff-panel">
        <h2 className="staff-section-title">Editar producto</h2>
        <EditProductForm key={`${product.id}-${product.name}-${product.categoryId}`} productId={product.id} name={product.name} categoryId={product.categoryId} categories={categories} />
      </section>}

      <section className="staff-card staff-panel">
        <h2 className="staff-section-title">Variantes</h2>
        <ul className="staff-variant-list">
          {product.variants.map((variant) => (
            <li key={variant.id}>
              <span>
                <strong>{variant.name}</strong>
                <small>{formatQuantity(variant.stock, variant.unitLabel)} en existencia</small>
              </span>
              <span className="staff-price">{formatMoney(variant.priceCents)}</span>
            </li>
          ))}
        </ul>
        {product.canEditPrices ? (
          <details className="staff-details">
            <summary>Editar variantes, precios y existencias</summary>
            <div className="staff-details-body">
              {product.variants.map((variant) => (
                <EditVariantForm key={`${variant.id}-${variant.name}-${variant.priceCents}-${variant.stock}`} variant={variant} allowsDecimal={product.allowsDecimal} />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      {product.isLaPaz && product.variants.length ? (
        <section className="staff-card staff-panel">
          <h2 className="staff-section-title">Registrar entrada</h2>
          <EntryForm
            variants={product.variants.map((variant) => ({ id: variant.id, name: variant.name, stock: variant.stock }))}
            allowsDecimal={product.allowsDecimal}
            evidenceAvailable={product.evidenceAvailable}
          />
        </section>
      ) : null}

      {product.canEditPrices && product.imageCount < MAX_PRODUCT_IMAGES ? (
        <section className="staff-card staff-panel">
          <h2 className="staff-section-title">Fotos ({product.imageCount} de {MAX_PRODUCT_IMAGES})</h2>
          <AddPhotoForm productId={product.id} />
        </section>
      ) : null}

      <section className="staff-card staff-panel">
        <h2 className="staff-section-title">Historial de movimientos</h2>
        {product.movements.length ? (
          <ul className="staff-history">
            {product.movements.map((movement) => (
              <li key={movement.id}>
                <span className={movement.quantity > 0 ? "staff-delta staff-delta-in" : movement.quantity < 0 ? "staff-delta staff-delta-out" : "staff-delta"}>
                  {movement.quantity > 0 ? "+" : ""}
                  {formatQuantity(movement.quantity)}
                </span>
                <span className="staff-history-main">
                  <strong>
                    {MOVEMENT_LABELS[movement.type] ?? movement.type}
                    {product.variants.length > 1 ? ` · ${movement.variantName}` : ""}
                  </strong>
                  <small>
                    {movement.byName} · {formatDateTime(movement.createdAt)}
                  </small>
                  {movement.reason ? <small>{movement.reason}</small> : null}
                </span>
                {movement.evidenceUrl ? (
                  <a className="staff-link-button" href={movement.evidenceUrl} target="_blank" rel="noreferrer">
                    Ver foto
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="staff-hint">Sin movimientos todavía.</p>
        )}
      </section>
    </main>
  );
}
