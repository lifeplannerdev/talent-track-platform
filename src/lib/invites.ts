import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mail";
import { buildInviteMail } from "@/lib/mail/invite-template";
import { INVITE_LIFETIME_HOURS, buildInviteLink, type InviteLinkResult } from "@/lib/invite-link";

export { INVITE_LIFETIME_HOURS };

/** A one-time set-password link for `studentId` (service role). See buildInviteLink. */
export async function createInviteLink(studentId: string): Promise<InviteLinkResult> {
  return buildInviteLink(createAdminClient(), studentId, process.env.APP_URL);
}

/**
 * Emails the student a link to choose their password. "skipped" when the student has no contact
 * email, "failed" when anything goes wrong (no link, bad APP_URL, mail not sent): the account
 * already exists then, and staff can resend. Never throws, never returns or logs the link.
 */
export async function sendInvite(studentId: string): Promise<"sent" | "failed" | "skipped"> {
  try {
    const admin = createAdminClient();
    const { data: details } = await admin
      .from("student_details")
      .select("contact_email")
      .eq("student_id", studentId)
      .maybeSingle<{ contact_email: string }>();
    const to = details?.contact_email?.trim();
    if (!to) return "skipped";

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, username")
      .eq("id", studentId)
      .maybeSingle<{ full_name: string | null; username: string }>();
    if (!profile) return "failed";

    const link = await createInviteLink(studentId);
    if (!link.ok) return "failed";
    // Throws for a link that is not http(s), i.e. a bad APP_URL.
    const mail = buildInviteMail({ fullName: profile.full_name ?? profile.username, username: profile.username, link: link.link });
    const sent = await sendMail({ ...mail, to });
    return sent.ok ? "sent" : "failed";
  } catch {
    console.error("[invite] sending the invite failed");
    return "failed";
  }
}

/**
 * Emails a trainer (or any account whose contact is its Auth email) a link to choose a password.
 * The address is the Auth user's email, which is also what they sign in with. "failed" on any
 * problem (the account exists already; an admin can resend). Never throws, never logs the link.
 */
export async function sendAccountInvite(userId: string): Promise<"sent" | "failed"> {
  try {
    const admin = createAdminClient();
    const { data: found } = await admin.auth.admin.getUserById(userId);
    const to = found?.user?.email?.trim();
    if (!to) return "failed";
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, username")
      .eq("id", userId)
      .maybeSingle<{ full_name: string | null; username: string }>();
    if (!profile) return "failed";
    const link = await createInviteLink(userId);
    if (!link.ok) return "failed";
    const mail = buildInviteMail({
      fullName: profile.full_name ?? profile.username,
      username: profile.username,
      link: link.link,
      signIn: { label: "Email address", value: to },
    });
    const sent = await sendMail({ ...mail, to });
    return sent.ok ? "sent" : "failed";
  } catch {
    console.error("[invite] sending the account invite failed");
    return "failed";
  }
}
