"use client";

import { useActionState, useEffect, useState } from "react";
import { ConfirmAction } from "../../../components/admin/ConfirmAction";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Dialog } from "../../../components/ui/Dialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Fields";
import { emptyActionState } from "../../../lib/actions";
import { formatDate } from "../../../lib/format";
import { createCategoryAction, setCategoryActiveAction, updateCategoryAction } from "./actions";

type Category = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  productCount: number;
};

function CategoryDialog({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  category: Category | null;
}) {
  const [state, action, pending] = useActionState(
    category ? updateCategoryAction : createCategoryAction,
    emptyActionState,
  );

  useEffect(() => {
    if (state.success) onClose();
    // onClose identity is stable enough here; reacting to the success flag is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} title={category ? "Editar categoría" : "Nueva categoría"} onClose={onClose}>
      <form action={action} className="dialog-form" key={category?.id ?? "new"}>
        {category ? <input type="hidden" name="id" value={category.id} /> : null}
        <Input
          id="category-name"
          name="name"
          label="Nombre de la categoría"
          defaultValue={category?.name ?? ""}
          maxLength={80}
          required
        />
        <p className="admin-hint">
          La dirección web (slug) se genera automáticamente a partir del nombre y se mantiene única.
        </p>
        {state.error && (
          <p className="form-message form-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="admin-form-actions">
          <Button type="button" variant="secondary" size="small" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="small" disabled={pending}>
            {pending ? "Guardando…" : category ? "Guardar cambios" : "Crear categoría"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [dialog, setDialog] = useState<{ open: boolean; category: Category | null }>({
    open: false,
    category: null,
  });

  return (
    <>
      <div className="admin-toolbar">
        <div className="admin-toolbar-actions">
          <Button size="small" type="button" onClick={() => setDialog({ open: true, category: null })}>
            Nueva categoría <span aria-hidden>＋</span>
          </Button>
        </div>
      </div>

      <Card className="admin-panel">
        {categories.length ? (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Slug</th>
                  <th className="numeric">Productos</th>
                  <th>Estado</th>
                  <th>Creada</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <strong>{category.name}</strong>
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{category.slug}</td>
                    <td className="numeric">{category.productCount}</td>
                    <td>
                      {category.is_active ? (
                        <Badge tone="success">Activa</Badge>
                      ) : (
                        <Badge tone="neutral">Archivada</Badge>
                      )}
                    </td>
                    <td style={{ color: "var(--admin-muted)" }}>{formatDate(category.created_at)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          size="small"
                          onClick={() => setDialog({ open: true, category })}
                        >
                          Editar
                        </Button>
                        <ConfirmAction
                          action={setCategoryActiveAction}
                          fields={{ id: category.id, active: category.is_active ? "false" : "true" }}
                          triggerLabel={category.is_active ? "Archivar" : "Restaurar"}
                          title={category.is_active ? "Archivar categoría" : "Restaurar categoría"}
                          description={
                            category.is_active
                              ? `"${category.name}" dejará de aparecer al crear productos y se ocultará del catálogo público. Los ${category.productCount} producto(s) que la usan no se eliminan.`
                              : `"${category.name}" volverá a estar disponible para nuevos productos y para el catálogo público.`
                          }
                          confirmLabel={category.is_active ? "Archivar" : "Restaurar"}
                          variant={category.is_active ? "danger" : "primary"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Aún no tienes categorías"
            description="Las categorías organizan el inventario y el catálogo público. Crea la primera para empezar."
          />
        )}
      </Card>

      <CategoryDialog
        open={dialog.open}
        category={dialog.category}
        onClose={() => setDialog({ open: false, category: null })}
      />
    </>
  );
}
