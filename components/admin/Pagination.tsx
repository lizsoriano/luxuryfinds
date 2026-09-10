import { Button } from "../ui/Button";

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

  return (
    <div className="admin-pagination">
      <span>
        {total === 0 ? "Sin resultados" : `Mostrando ${first}–${last} de ${total}`}
      </span>
      <span style={{ display: "flex", gap: 8 }}>
        {page > 1 ? (
          <Button href={buildHref(page - 1)} variant="secondary" size="small">
            ← Anterior
          </Button>
        ) : null}
        {hasNextPage ? (
          <Button href={buildHref(page + 1)} variant="secondary" size="small">
            Siguiente →
          </Button>
        ) : null}
      </span>
    </div>
  );
}
