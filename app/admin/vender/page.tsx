import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { businessToday } from "../../../lib/format";
import { listSellableVariants } from "../../../lib/supabase/admin-catalog";
import { getOpenCashSession } from "../../../lib/supabase/admin-commerce";
import { listClientOptions, listSupplierOptions } from "../../../lib/supabase/admin-contacts";
import { SellTerminal } from "./SellTerminal";

export const dynamic = "force-dynamic";

export default async function SellPage() {
  let variants;
  let clients: Array<{ id: string; label: string }> = [];
  let suppliers: Array<{ id: string; label: string }> = [];
  let session = null;

  try {
    [variants, clients, suppliers, session] = await Promise.all([
      listSellableVariants(),
      listClientOptions(),
      listSupplierOptions(),
      getOpenCashSession(),
    ]);
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="GESTIONA TU NEGOCIO" title="Vender" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos preparar el punto de venta: {error instanceof Error ? error.message : "error desconocido"}
          </p>
          <p className="admin-hint" style={{ marginTop: 12 }}>
            Si es la primera vez que abres esta pantalla, aplica
            database/migrations/002_business_management.sql en el editor SQL de Supabase.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="GESTIONA TU NEGOCIO"
        title="Vender"
        description="Venta directa de mostrador. No sustituye a los pedidos con plan de pagos: esto es para cobrar en el momento y descontar inventario al instante."
      />
      <SellTerminal
        variants={variants}
        clients={clients}
        suppliers={suppliers}
        session={
          session
            ? { id: session.id, opening_amount_cents: session.opening_amount_cents, opened_at: session.opened_at }
            : null
        }
        today={businessToday()}
      />
    </main>
  );
}
