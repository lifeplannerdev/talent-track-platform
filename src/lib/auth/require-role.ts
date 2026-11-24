import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole, type Role, type RoleGroup } from "./roles";

export { isStaffRole };
export type { Role, RoleGroup };

export type Profile = {
  id: string;
  role: Role;
  username: string;
  full_name: string | null;
  batch: string | null;
  track: string | null;
  consent_at: string | null;
  trainer_id: string | null;
  active: boolean;
};

/**
 * Returns the signed-in user's profile, or redirects: /login (signed out, no profile or a
 * deactivated one), wrong role to its own area. "staff" passes admin and trainer.
 */
export async function requireRole(role: RoleGroup): Promise<Profile> {
  // Session checks read the clock (token expiry), so render per request, never during prerender.
  await connection();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, username, full_name, batch, track, consent_at, trainer_id, active")
    .eq("id", userData.user.id)
    .single<Profile>();
  if (!profile || !profile.active) redirect("/login");

  const allowed = role === "staff" ? isStaffRole(profile.role) : profile.role === role;
  if (!allowed) {
    redirect(isStaffRole(profile.role) ? "/staff" : "/exam/start");
  }
  return profile;
}

/** An active admin, or a redirect (a trainer goes to /staff, a student to /exam/start). */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireRole("staff");
  if (profile.role !== "admin") redirect("/staff");
  return profile;
}

/**
 * A signed-in student who has given consent, or a redirect (/login, the staff area, /consent).
 * Every student server action that touches an exam uses this: the proxy's consent redirect only
 * covers page requests, and server actions can be called directly.
 */
export async function requireStudentWithConsent(): Promise<Profile> {
  const profile = await requireRole("student");
  if (!profile.consent_at) redirect("/consent");
  return profile;
}
