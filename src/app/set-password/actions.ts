"use server";

import { redirect } from "next/navigation";
import { checkPassword } from "@/lib/csv/students";
import { createClient } from "@/lib/supabase/server";

export type SetPasswordResult = { ok: false; message: string };

// One message for every token problem (used, expired, garbage, empty), so the page tells an
// outsider nothing about which tokens exist.
const INVALID_LINK = "This link is no longer valid. Ask your trainer to send you a new one.";
const NOT_SAVED = "Your password could not be saved. Ask your trainer to send you a new link.";

/**
 * Sets the account's password from an invite link. This is the only place the one-time token is
 * used up (never on opening the page, because mail scanners prefetch links). The password is
 * checked first, so a weak one does not burn the token. Neither the token nor the password is
 * logged or returned. On success the browser is sent to /login, with every session ended.
 */
export async function setPasswordAction(input: { tokenHash: string; password: string }): Promise<SetPasswordResult> {
  const tokenHash = typeof input?.tokenHash === "string" ? input.tokenHash.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!tokenHash) return { ok: false, message: INVALID_LINK };
  const problem = password ? checkPassword(password) : "Enter a new password.";
  if (problem) return { ok: false, message: problem };

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (verifyError) return { ok: false, message: INVALID_LINK };

  // From here on the token is spent and this request holds a session for the account.
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    console.error("setPasswordAction: updateUser failed", updateError.code ?? updateError.status ?? "unknown");
    await supabase.auth.signOut({ scope: "local" });
    return { ok: false, message: NOT_SAVED };
  }
  // End the account's other sessions (the old password's), then this one: the student signs in
  // on /login with the new password like everyone else.
  const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
  if (othersError) console.error("setPasswordAction: signOut others failed", othersError.code ?? othersError.status ?? "unknown");
  await supabase.auth.signOut({ scope: "local" });
  if (othersError) return { ok: false, message: NOT_SAVED };
  redirect("/login");
}
