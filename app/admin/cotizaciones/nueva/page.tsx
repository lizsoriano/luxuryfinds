import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { businessToday } from "../../../../lib/format";
import { listSellableVariants } from "../../../../lib/supabase/admin-catalog";
import { listClientOptions } from "../../../../lib/supabase/admin-contacts";
import { NewQuoteForm, type QuotableVariant } from "../NewQuoteForm";

export const dynamic = "force-dynamic";

/** Adds `days` to a "YYYY-MM-DD" calendar date in UTC, so DST can never shift it. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function NewQuotePage() {
  const today = businessToday();
  let variants: QuotableVariant[] = [];
  let clients: Array<{ id: string; label: string; phone: string }> = [];

  try {
    const [sellable, clientOptions] = await Promise.all([listSellableVariants(), listClientOptions()]);
    variants = sellable.map((variant) => ({
      variantId: variant.variantId,
      productId: variant.productId,
      productName: variant.productName,
      variantName: variant.variantName,
      priceCents: variant.priceCents,
      stock: variant.stock,
    }));
    clients = clientOptions;
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="GESTIONA TU NEGOCIO" title="Nueva cotización" />
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
        eyebrow="GESTIONA TU NEGOCIO"
        title="Nueva cotización"
        description="Arma el presupuesto con los productos y precios que le vas a pasar a la clienta, y hasta cuándo se los respetas."
        action={
          <Button href="/admin/cotizaciones" variant="secondary" size="small">
            Volver
          </Button>
        }
      />
      <div style={{ marginTop: 20 }}>
        <NewQuoteForm clients={clients} variants={variants} today={today} defaultValidUntil={addDays(today, 15)} />
      </div>
    </main>
  );
}
