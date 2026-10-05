import Link from "next/link";
import { listStaffCategories } from "../../../../lib/supabase/staff-inventory";
import { NewProductForm } from "../InventoryForms";

export const dynamic = "force-dynamic";

export default async function StaffNewProductPage() {
  let categories: Array<{ id: string; name: string }> = [];
  let loadError: string | null = null;
  try {
    categories = await listStaffCategories();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "error desconocido";
  }

  return (
    <main className="staff-content staff-narrow">
      <Link className="staff-back" href="/empleado/inventario">
        ← Inventario en La Paz
      </Link>
      <h1 className="staff-title">Añadir producto</h1>
      <p className="staff-lead">Mercancía que ya está en La Paz, lista para venderse o entregarse.</p>
      {loadError ? (
        <p className="form-message form-error" role="alert">
          No pudimos cargar las categorías: {loadError}
        </p>
      ) : null}
      <div className="staff-card staff-panel">
        <NewProductForm categories={categories} />
      </div>
    </main>
  );
}
