import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Same identity convention as the cart (lib/cart/CartContext.tsx): slug when the product has one, else its raw id. */
function identityOf(row: { id: string; slug: string | null }) {
  return row.slug ?? row.id;
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ authenticated: false, identities: [] });

  const { data, error } = await supabase
    .schema("luxury_finds")
    .from("favorites")
    .select("products(id, slug)")
    .order("created_at", { ascending: false });
  if (error) return Response.json({ authenticated: true, identities: [], error: error.message }, { status: 500 });

  const identities = (data ?? []).flatMap((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return product ? [identityOf(product)] : [];
  });
  return Response.json({ authenticated: true, identities });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "no_autenticado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const identity = typeof body?.identity === "string" ? body.identity.trim() : "";
  if (!identity) return Response.json({ error: "Falta el producto." }, { status: 400 });

  // The client only knows the public slug-or-id identity, never products.id directly
  // (same reason checkout re-resolves the cart server-side: never trust an id from
  // the browser). Look the real row up here with the admin client, which can read
  // is_public/is_active-gated products regardless of the caller's own RLS grants.
  const admin = createAdminSupabaseClient().schema("luxury_finds");
  const bySlug = await admin.from("products").select("id, slug").eq("slug", identity).eq("is_public", true).eq("is_active", true).maybeSingle();
  const product = bySlug.data ?? (await admin.from("products").select("id, slug").eq("id", identity).eq("is_public", true).eq("is_active", true).maybeSingle()).data;
  if (!product) return Response.json({ error: "Producto no encontrado." }, { status: 404 });

  const existing = await supabase
    .schema("luxury_finds")
    .from("favorites")
    .select("id")
    .eq("client_id", auth.user.id)
    .eq("product_id", product.id)
    .maybeSingle();

  if (existing.data) {
    const { error } = await supabase.schema("luxury_finds").from("favorites").delete().eq("id", existing.data.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ favorited: false });
  }

  const { error } = await supabase
    .schema("luxury_finds")
    .from("favorites")
    .insert({ client_id: auth.user.id, product_id: product.id });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ favorited: true });
}
