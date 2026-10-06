import Link from "next/link";

export function InventoryPagination({ page, totalPages, search = "" }: { page: number; totalPages: number; search?: string }) {
  const start = Math.min(Math.max(1, page - 1), Math.max(1, totalPages - 3));
  const numbers = Array.from({ length: Math.min(4, totalPages) }, (_, index) => start + index);
  function href(target: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (target > 1) params.set("pagina", String(target));
    return `/empleado/inventario${params.size ? `?${params}` : ""}`;
  }
  if (totalPages <= 1) return null;
  return <nav className="staff-pagination staff-pagination-numbered" aria-label="Páginas del inventario">
    {page > 1 ? <Link className="staff-page-button" href={href(page - 1)} aria-label="Página anterior">←</Link> : <span className="staff-page-button is-disabled" aria-disabled="true" aria-label="Página anterior">←</span>}
    {numbers.map(number => <Link className={`staff-page-button${number === page ? " is-current" : ""}`} href={href(number)} key={number} aria-label={`Página ${number}`} aria-current={number === page ? "page" : undefined}>{number}</Link>)}
    {page < totalPages ? <Link className="staff-page-button" href={href(page + 1)} aria-label="Página siguiente">→</Link> : <span className="staff-page-button is-disabled" aria-disabled="true" aria-label="Página siguiente">→</span>}
  </nav>;
}
