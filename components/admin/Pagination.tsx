import Link from "next/link";

/** Server-rendered pagination: lists never load the whole table at once. */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
  hasNextPage,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
}) {
  const buildHref = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize), hasNextPage ? page + 1 : 1);

  // First page, last page and the neighbours of the current one; "…" fills the gaps.
  const visible = new Set([1, totalPages, page - 1, page, page + 1]);
  const items: (number | "gap-before" | "gap-after")[] = [];
  let previous = 0;
  for (const number of [...visible].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)) {
    if (number - previous > 1) items.push(previous === 1 ? "gap-before" : "gap-after");
    items.push(number);
    previous = number;
  }

  return (
    <div className="admin-pagination">
      <span>
        {total === 0 ? "Sin resultados" : `Mostrando ${first}–${last} de ${total}`}
      </span>
      {totalPages > 1 && (
        <nav className="admin-pagination-nav" aria-label="Páginas">
          {page > 1 && <Link href={buildHref(page - 1)} className="admin-pagination-step" aria-label="Página anterior">←</Link>}
          {items.map((item) =>
            typeof item === "string" ? (
              <span key={item} className="admin-pagination-gap" aria-hidden>…</span>
            ) : (
              <Link
                key={item}
                href={buildHref(item)}
                className={item === page ? "admin-pagination-number active" : "admin-pagination-number"}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Página ${item}`}
              >
                {item}
              </Link>
            ),
          )}
          {page < totalPages && <Link href={buildHref(page + 1)} className="admin-pagination-step" aria-label="Página siguiente">→</Link>}
        </nav>
      )}
    </div>
  );
}
