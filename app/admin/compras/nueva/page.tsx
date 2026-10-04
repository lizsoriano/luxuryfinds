import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { businessToday } from "../../../../lib/format";
import { listSupplierOptions } from "../../../../lib/supabase/admin-contacts";
import { getLastExchangeRate, listPurchases, PURCHASES_UNAVAILABLE_MESSAGE } from "../../../../lib/supabase/admin-purchases";
import { PurchaseHeaderForm } from "../PurchaseHeaderForm";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage() {
  const today = businessToday();
  let shoppers: Array<{ id: string; label: string }> = [];
  let lastRate: number | null = null;
  let unavailable = false;
  try {
    // A one-row read is enough to know whether migration 010 exists.
    const [probe, options, rate] = await Promise.all([listPurchases({ page: 1 }), listSupplierOptions(), getLastExchangeRate()]);
    unavailable = probe.unavailable;
    shoppers = options;
    lastRate = rate;
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="COMPRAS CON SHOPPER" title="Nueva compra" />
        <Card className="admin-panel" style={{ marginTop: 24 }}>
          <p className="form-message form-error" role="alert">
            No pudimos preparar el formulario: {error instanceof Error ? error.message : "error desconocido"}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-content">
      <PageHeader
        eyebrow="COMPRAS CON SHOPPER"
        title="Nueva compra"
        description="Elige al shopper y captura el tipo de cambio y la comisión de esta compra. Después agregas sus tickets y artículos."
        action={
          <Button href="/admin/compras" variant="secondary" size="small">
            Volver
          </Button>
        }
      />
      <Card className="admin-panel shopper-narrow" style={{ marginTop: 20 }}>
        {unavailable ? (
          <p className="form-message form-error" role="alert">
            {PURCHASES_UNAVAILABLE_MESSAGE}
          </p>
        ) : (
          <PurchaseHeaderForm
            shoppers={shoppers}
            today={today}
            lastRate={lastRate}
            initial={{ supplierId: "", purchaseDate: today, exchangeRate: "", commission: "", notes: "" }}
          />
        )}
      </Card>
    </main>
  );
}
