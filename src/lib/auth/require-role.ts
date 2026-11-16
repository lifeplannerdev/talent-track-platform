import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type Role = "staff" | "student";

export type Profile = {
  id: string;
  role: Role;
  username: string;
  full_name: string | null;
  batch: string | null;
  track: string | null;
  consent_at: string | null;
};

/** Returns the signed-in user's profile, or redirects to /login (wrong role goes to its own area). */
export async function requireRole(role: Role): Promise<Profile> {
  // Session checks read the clock (token expiry), so render per request, never during prerender.
  await connection();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, username, full_name, batch, track, consent_at")
    .eq("id", userData.user.id)
    .single<Profile>();
  if (!profile) redirect("/login");

  if (profile.role !== role) {
    redirect(profile.role === "staff" ? "/staff" : "/exam/start");
  }
  return profile;
}
