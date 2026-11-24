import type { SupabaseClient } from "@supabase/supabase-js";

// Deliberately free of "server-only" and of the admin client factory so the e2e seed can reuse the
// exact same code with its own service-role client (see e2e/set-password.spec.ts).

/**
 * How long an invite link works, in hours. The mail template states it, and the Auth OTP expiry
 * must match: supabase/config.toml `[auth.email] otp_expiry = INVITE_LIFETIME_HOURS * 3600`
 * locally, and the same value in the hosted dashboard (Authentication, Email, "Email OTP
 * expiration") for production. Hosted Auth allows at most 86400 seconds (24 hours) and defaults
 * to 1 hour, so set it to 86400 before inviting real students. After that, staff use "Resend
 * invite" on the student page.
 */
export const INVITE_LIFETIME_HOURS = 24;

export type InviteLinkResult = { ok: true; link: string } | { ok: false };

/**
 * One-time set-password link for an existing auth user. The email is read from the auth user
 * (trainers have real emails, students an internal one), never recomputed. Creating the link
 * does not consume it: the token is used up only when the new password is submitted. Never
 * throws and never logs the link.
 */
export async function buildInviteLink(
  admin: SupabaseClient,
  studentId: string,
  appUrl: string | undefined,
): Promise<InviteLinkResult> {
  try {
    const base = (appUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) {
      console.error("[invite] APP_URL is not set, no link was made");
      return { ok: false };
    }
    const { data: found, error: userError } = await admin.auth.admin.getUserById(studentId);
    const email = found?.user?.email;
    if (userError || !email) {
      console.error("[invite] the account to invite was not found");
      return { ok: false };
    }
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    const token = data?.properties?.hashed_token;
    if (error || !token) {
      console.error("[invite] the Auth server did not give a link", error?.code ?? error?.status ?? "unknown");
      return { ok: false };
    }
    return { ok: true, link: `${base}/set-password?token_hash=${encodeURIComponent(token)}` };
  } catch {
    console.error("[invite] unexpected failure while making a link");
    return { ok: false };
  }
}
