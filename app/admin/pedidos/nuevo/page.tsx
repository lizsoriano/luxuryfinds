import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { getWeeklyPlanEligibility, listSellableVariants } from "../../../../lib/supabase/admin-catalog";
import { listClientOptions } from "../../../../lib/supabase/admin-contacts";
import { NewOrderForm, type OrderableVariant } from "../NewOrderForm";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  let variants: OrderableVariant[] = [];
  let clients: Array<{ id: string; label: string; phone: string }> = [];

  try {
    const [sellable, clientOptions] = await Promise.all([listSellableVariants(), listClientOptions()]);
    const eligibility = await getWeeklyPlanEligibility([...new Set(sellable.map((variant) => variant.productId))]);
    variants = sellable.map((variant) => ({
      variantId: variant.variantId,
      productId: variant.productId,
      productName: variant.productName,
      variantName: variant.variantName,
      priceCents: variant.priceCents,
      weeklyPlanEligible: eligibility.get(variant.productId) ?? false,
    }));
    clients = clientOptions;
  } catch (error) {
    return (
      <main className="admin-content">
        <PageHeader eyebrow="VENDER" title="Nuevo pedido" />
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
        eyebrow="VENDER"
        title="Nuevo pedido"
        description="Para pedidos que entran por WhatsApp, teléfono o en persona. Se crea como borrador; confírmalo desde su detalle cuando quede claro."
        action={
          <Button href="/admin/pedidos" variant="secondary" size="small">
            Volver
          </Button>
        }
      />
      <div style={{ marginTop: 20 }}>
        <NewOrderForm clients={clients} variants={variants} />
      </div>
    </main>
  );
}
