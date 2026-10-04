import { getAdminSession } from "../../../../lib/supabase/auth";
import { isProductSegment, listProductsForExport } from "../../../../lib/supabase/admin-catalog";
import { SEGMENTS } from "../segments";

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
  // Each list exports only its own section; without `segmento` (old links) it
  // keeps exporting everything, as before.
  const rawSegment = url.searchParams.get("segmento");
  const segment = isProductSegment(rawSegment) ? rawSegment : undefined;
  let rows;
  try {
    rows = await listProductsForExport({
      search: url.searchParams.get("q") ?? undefined,
      categoryId: url.searchParams.get("categoria") ?? undefined,
      includeArchived: url.searchParams.get("archivados") === "1",
      segment,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "No fue posible exportar.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

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
      "Content-Disposition": `attachment; filename="${segment ? SEGMENTS[segment].exportFileName : "productos"}-luxury-finds.csv"`,
    },
  });
}
