import { notFound } from "next/navigation";
import { ConfirmAction } from "../../../../components/admin/ConfirmAction";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { getProductDetail, listActiveCategories } from "../../../../lib/supabase/admin-catalog";
import { deleteProductImageAction } from "../actions";
import { ProductForm } from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let product;
  let categories: Array<{ id: string; name: string }> = [];
  try {
    [product, categories] = await Promise.all([getProductDetail(id), listActiveCategories()]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="INVENTARIO" title="Editar producto" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar el producto: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }
  if (!product) notFound();

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="INVENTARIO"
        title={product.name}
        description={`${product.variants.length} variante(s) · ${product.is_active ? "Activo" : "Archivado"} · ${
          product.is_public ? "Visible en el catálogo público" : "Oculto del catálogo público"
        }`}
        action={
          <Button href="/admin/inventario" variant="secondary" size="small">
            Ver en Inventario
          </Button>
        }
      />

      {product.images.length ? (
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="micro-label">IMÁGENES ACTUALES</p>
          <div className="admin-image-row" style={{ marginTop: 12 }}>
            {product.images.map((image) => (
              <div key={image.id} style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                <div className="admin-image-slot">
                  {image.url ? <img src={image.url} alt="" /> : <span className="admin-hint">Sin vista previa</span>}
                </div>
                <ConfirmAction
                  action={deleteProductImageAction}
                  fields={{ imageId: image.id, productId: product.id }}
                  triggerLabel="Eliminar"
                  title="Eliminar imagen"
                  description="La imagen se borra del almacenamiento y deja de mostrarse en el catálogo público. Esta acción no se puede deshacer."
                  confirmLabel="Eliminar"
                  variant="danger"
                />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <ProductForm
          categories={categories}
          existingImageCount={product.images.length}
          product={{
            id: product.id,
            name: product.name,
            description: product.description,
            internal_code: product.internal_code,
            category_id: product.category_id,
            catalog_type: product.catalog_type,
            product_kind: product.product_kind,
            tax_rate_percent: product.tax_rate_percent,
            is_public: product.is_public,
            variants: product.variants.map((variant) => ({
              id: variant.id,
              name: variant.name,
              sku: variant.sku,
              price_cents: variant.price_cents,
              cost_cents: variant.cost_cents,
              min_quantity: variant.min_quantity,
              unit_label: variant.unit_label,
              stock: variant.stock,
            })),
          }}
        />
      </div>
    </main>
  );
}
