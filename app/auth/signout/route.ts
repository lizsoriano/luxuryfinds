import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Redirecting to login is safe even if the session was already unavailable.
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
