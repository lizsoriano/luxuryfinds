import { SectionLabel } from "../../../components/ui/SectionLabel";
import { requireAuthenticatedUser } from "../../../lib/supabase/auth";
import { CheckoutClient } from "./CheckoutClient";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  // Gates the whole page on an authenticated session — redirects to
  // /login?next=/checkout otherwise, where the shopper can also choose to
  // create an account instead. The cart itself lives in localStorage, so it
  // is read client-side by CheckoutClient once this gate has passed.
  await requireAuthenticatedUser("/checkout");

  return (
    <main className="checkout-page">
      <div className="shell">
        <SectionLabel>ÚLTIMO PASO</SectionLabel>
        <h1>Confirmar pedido</h1>
        <CheckoutClient />
      </div>
    </main>
  );
}
