/** Routes an unauthenticated visitor may open: the landing page, the sign-in page and the set-password page (invite links). Exact matches only. */
const PUBLIC_PATHS = new Set(["/", "/login", "/set-password"]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}
