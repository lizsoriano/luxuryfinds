export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    runtime: typeof (globalThis as Record<string, unknown>).EdgeRuntime !== "undefined" ? "edge" : "nodejs",
    vercelEnv: process.env.VERCEL_ENV ?? null,
  });
}
