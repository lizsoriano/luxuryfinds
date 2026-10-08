import { AccountPurchases } from "../../../components/account/AccountPurchases";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { getAccountData } from "../../../lib/supabase/account";

export const dynamic = "force-dynamic";
export default async function PurchasesPage() {
  const data = await getAccountData();
  const tickets = data.profile ? [...data.tickets, ...data.salePurchases] : [];
  return <main className="account-content"><PageHeader eyebrow="MI CUENTA" title="Mis compras" description="Consulta tus productos y su estado de entrega." />{tickets.length ? <AccountPurchases tickets={tickets} /> : <EmptyState title="Aún no tienes compras" description="Tus compras aparecerán aquí cuando las registremos." href="/catalogo" action="Ver catálogo" />}</main>;
}
