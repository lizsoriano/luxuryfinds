import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { listCategoriesWithCounts } from "../../../lib/supabase/admin-catalog";
import { CategoriesManager } from "./CategoriesManager";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  let categories;
  try {
    categories = await listCategoriesWithCounts();
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="INVENTARIO" title="Categorías" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos cargar las categorías: {error instanceof Error ? error.message : "error desconocido"}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Verifica la conexión con Supabase y que las migraciones de database/migrations estén aplicadas.
          </p>
        </Card>
      </main>
    );
  }

  const active = categories.filter((category) => category.is_active).length;

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="INVENTARIO"
        title="Categorías"
        description={`${active} activa(s) de ${categories.length} en total. Las categorías se comparten entre el inventario, el punto de venta y el catálogo público.`}
        action={
          <Button href="/admin/inventario" variant="secondary" size="small">
            Ir a Inventario
          </Button>
        }
      />
      <CategoriesManager categories={categories} />
    </main>
  );
}
