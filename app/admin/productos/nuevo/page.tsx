import { Card } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { listActiveCategories } from "../../../../lib/supabase/admin-catalog";
import { ProductForm } from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  let categories: Array<{ id: string; name: string }> = [];
  let loadError: string | null = null;
  try {
    categories = await listActiveCategories();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "error desconocido";
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="INVENTARIO"
        title="Crear producto"
        description="El producto quedará disponible en Inventario y en Vender. Si lo marcas como visible, también aparecerá en el catálogo público."
      />
      {loadError ? (
        <Card className="admin-panel" style={{ marginTop: 24, marginBottom: 16 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar las categorías ({loadError}). Puedes crear el producto y escribir una categoría nueva.
          </p>
        </Card>
      ) : null}
      <div style={{ marginTop: 24 }}>
        <ProductForm categories={categories} />
      </div>
    </main>
  );
}
