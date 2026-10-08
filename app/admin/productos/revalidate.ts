import { revalidatePath } from "next/cache";

/** Every page that shows product data (admin lists, POS, staff inventory, public catalogue). */
export function revalidateCatalog() {
  revalidatePath("/empleado/inventario", "layout");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/entrega-inmediata");
  revalidatePath("/admin/productos/en-camino");
  revalidatePath("/admin/inventario");
  revalidatePath("/admin/vender");
  revalidatePath("/catalogo");
  revalidatePath("/entrega-inmediata");
  revalidatePath("/por-pedido");
}
