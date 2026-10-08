import Link from "next/link";
import { PurchaseCard } from "../../../components/account/AccountUi";
import { EmptyState } from "../../../components/ui/EmptyState";
import { getAccountOverview } from "../../../lib/supabase/account";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "activas", label: "En proceso" },
  { key: "entregadas", label: "Entregadas" },
  { key: "todas", label: "Todas" },
] as const;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const data = await getAccountOverview();
  const purchases = data.overview?.purchases ?? [];
  const counts = {
    activas: purchases.filter((p) => p.state === "ACTIVE" || p.state === "PENDING").length,
    entregadas: purchases.filter((p) => p.state === "DELIVERED").length,
    todas: purchases.length,
  };
  const filter = FILTERS.some((f) => f.key === ver) ? ver as keyof typeof counts : counts.activas ? "activas" : "todas";
  const shown = purchases.filter((p) => filter === "todas" || (filter === "activas" ? p.state === "ACTIVE" || p.state === "PENDING" : p.state === "DELIVERED"));

  return <main className="account-content acc-content">
    <header className="acc-page-head"><h1>Mis compras</h1><p>Tus tickets con foto, lo que pagaste y dónde está cada pedido.</p></header>
    {purchases.length > 0 && <nav className="acc-filter" aria-label="Filtrar compras">{FILTERS.map((f) => <Link key={f.key} href={`/cuenta/compras?ver=${f.key}`} className={filter === f.key ? "is-on" : ""} aria-current={filter === f.key ? "page" : undefined}>{f.label} <span>{counts[f.key]}</span></Link>)}</nav>}
    {shown.length
      ? <div className="acc-stack">{shown.map((purchase) => <PurchaseCard key={purchase.key} purchase={purchase} />)}</div>
      : purchases.length
        ? <p className="acc-card acc-pad acc-muted">No hay compras en esta lista.</p>
        : <EmptyState title="Aún no tienes compras" description="Tus compras aparecerán aquí en cuanto las registremos." href="/catalogo" action="Ver catálogo" />}
  </main>;
}
