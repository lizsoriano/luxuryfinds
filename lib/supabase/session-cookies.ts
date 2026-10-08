export const REMEMBER_COOKIE = "lf-remember-session";
export const REMEMBER_SECONDS = 30 * 24 * 60 * 60;

// Apply the same policy at sign-in and token refresh, preserving deletions.
export function sessionCookieOptions<T extends { maxAge?: number; expires?: Date }>(options: T, remember: boolean) {
  if (options.maxAge === 0) return options;
  const rest = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return remember ? { ...rest, maxAge: REMEMBER_SECONDS } : rest;
}
