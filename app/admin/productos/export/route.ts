import { getAdminSession } from "../../../../lib/supabase/auth";
import { listProductsForExport } from "../../../../lib/supabase/admin-catalog";

export const dynamic = "force-dynamic";

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (session.kind !== "authorized") {
    return new Response("No autorizado", { status: 401 });
  }

  const url = new URL(request.url);
  const rows = await listProductsForExport({
    search: url.searchParams.get("q") ?? undefined,
    categoryId: url.searchParams.get("categoria") ?? undefined,
    includeArchived: url.searchParams.get("archivados") === "1",
  });

  const header = ["Producto", "Código", "Categoría", "Tipo", "Variante", "SKU", "Stock", "Precio", "Costo", "Estado"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [row.producto, row.codigo, row.categoria, row.tipo, row.variante, row.sku, row.stock, row.precio, row.costo, row.estado]
        .map(csvCell)
        .join(","),
    );
  }

  const BOM = "\uFEFF";
  const csv = BOM + lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="productos-luxury-finds.csv"`,
    },
  });
}
