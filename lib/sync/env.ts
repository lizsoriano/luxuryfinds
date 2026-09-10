// Server-side configuration for the catalogue sync.
//
// Same shape as lib/telegram/env.ts: no secret is ever inlined, everything comes
// from process.env, and nothing in this file may be imported from a client
// component - SYNC_CRON_SECRET has no NEXT_PUBLIC_ prefix precisely so the
// bundler refuses to ship it to the browser.

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
