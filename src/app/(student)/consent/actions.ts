"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export async function acceptConsent() {
  const profile = await requireRole("student");
  // Students cannot update their own profile (RLS), so the timestamp is written with the service role.
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ consent_at: new Date().toISOString() })
    .eq("id", profile.id)
    .is("consent_at", null);
  if (error) throw new Error("Could not record consent");
  redirect("/learn");
}
