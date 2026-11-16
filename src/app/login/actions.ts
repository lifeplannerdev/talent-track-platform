"use server";

import { redirect } from "next/navigation";
import { usernameToEmail } from "@/lib/auth/username";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

const GENERIC_ERROR = "Incorrect username or password. Please try again.";

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) {
    return { error: "Enter your username (or email) and password." };
  }

  // Students sign in with a username; staff sign in with an email address.
  let email: string;
  if (identifier.includes("@")) {
    email = identifier.toLowerCase();
  } else {
    try {
      email = usernameToEmail(identifier);
    } catch {
      return { error: GENERIC_ERROR };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: GENERIC_ERROR };

  // One active session per account: end every other session of this user.
  await supabase.auth.signOut({ scope: "others" });

  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = userData.user
    ? await supabase
        .from("profiles")
        .select("role, consent_at")
        .eq("id", userData.user.id)
        .single()
    : { data: null };
  if (!profile) {
    await supabase.auth.signOut();
    return { error: GENERIC_ERROR };
  }
  // Go straight to the role's home (the proxy enforces the same rules on every request).
  redirect(
    profile.role === "staff"
      ? "/staff"
      : profile.consent_at
        ? "/exam/start"
        : "/consent",
  );
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
