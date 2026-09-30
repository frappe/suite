/**
 * `/login` returns to the same item inside the shell (spec §10.9).
 *
 * The fragment never goes along: it can hold a share-link token, and the
 * redirect would put it in a query string, server logs and referrers.
 */
export function signInUrl(fullPath: string): string {
  const [pathAndQuery = ""] = fullPath.split("#");
  return `/login?redirect-to=${encodeURIComponent(pathAndQuery)}`;
}
