/** Routes an unauthenticated visitor may open: the landing page and the sign-in page. Exact matches only. */
const PUBLIC_PATHS = new Set(["/", "/login"]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}
