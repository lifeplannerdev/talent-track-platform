/** Pure role definitions, safe to import from the proxy and client components. */
export type Role = "admin" | "trainer" | "student";
/** A single role, or "staff" meaning admin or trainer. */
export type RoleGroup = Role | "staff";

/** The one staff group: admin and trainer. */
export function isStaffRole(role: Role): boolean {
  return role === "admin" || role === "trainer";
}
