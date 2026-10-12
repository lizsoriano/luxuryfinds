// Server-side configuration for the catalogue sync.
//
// Same shape as lib/telegram/env.ts: no secret is ever inlined, everything comes
// from process.env, and nothing in this file may be imported from a client
// component - SYNC_CRON_SECRET has no NEXT_PUBLIC_ prefix precisely so the
// bundler refuses to ship it to the browser.

/**
 * Master switch for the AUTOMATIC catalogue sync: the daily Vercel cron and any
 * external scheduler calling /api/sync/run. The owner asked to stop it on
 * 2026-10-11. While false, that endpoint still runs its other daily job (expiring
 * "Próximamente" reservations) but no longer reads Maw Maw or Oskin, so nothing is
 * imported and no price moves on its own. "Sincronizar ahora" in the panel is a
 * deliberate, manual run and is not affected. Set it back to true to resume.
 */
export const AUTO_SYNC_ENABLED = false;

/**
 * Shared secret that authorises POST /api/sync/run. Set it in .env locally and
 * in the Vercel project's environment variables for production.
 */
export function getSyncCronSecret(): string | null {
  const secret = process.env.SYNC_CRON_SECRET?.trim();
  return secret ? secret : null;
}

export function hasSyncCronSecret(): boolean {
  return Boolean(getSyncCronSecret());
}

/**
 * Constant-time comparison, so a caller cannot learn the secret one byte at a
 * time from how long the endpoint takes to say no.
 */
export function matchesSyncCronSecret(candidate: string | null | undefined): boolean {
  const expected = getSyncCronSecret();
  if (!expected || !candidate) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
