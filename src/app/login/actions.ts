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

  // One active session per account: end every other session of this user. If that fails the
  // older sessions would stay valid, so the login is not completed (the new session is dropped).
  const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
  if (othersError) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "We could not sign you in right now. Please try again." };
  }

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
  const { error } = await supabase.auth.signOut();
  // If the Auth server cannot be reached the global sign-out fails and keeps the cookies;
  // always clear this browser's session so a shared computer is left signed out.
  if (error) await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
