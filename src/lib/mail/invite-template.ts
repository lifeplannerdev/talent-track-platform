import "server-only";
import type { MailMessage } from "./transports";
import { INVITE_LIFETIME_HOURS } from "../invite-link";

const BRAND = "#2346a0"; // Königsblau, DESIGN.md
const SANS = "'Source Sans 3', 'Segoe UI', Helvetica, Arial, sans-serif";
const HEADING = "Lexend, 'Segoe UI', Helvetica, Arial, sans-serif";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The invite carries the username and a one-time link to choose a password, never a password.
 * It has no recipient: callers do `sendMail({ ...buildInviteMail(...), to })`.
 */
export function buildInviteMail({
  fullName,
  username,
  link,
  signIn,
}: {
  fullName: string;
  username: string;
  link: string;
  /** What the person signs in with; students use the username (default), trainers their email. */
  signIn?: { label: string; value: string };
}): Omit<MailMessage, "to"> {
  if (!/^https?:\/\//i.test(link)) {
    throw new Error("buildInviteMail: link must start with http:// or https:// (check APP_URL)");
  }
  const id = signIn ?? { label: "Username", value: username };
  const idWord = id.label.toLowerCase();
  const subject = "Your Talent Track Platform account";
  const text = [
    `Hello ${fullName},`,
    "",
    "Your Talent Track Platform account is ready.",
    "",
    `${id.label}: ${id.value}`,
    "",
    `Open this link to choose your own password (it can be used once, within ${INVITE_LIFETIME_HOURS} hours):`,
    link,
    "",
    `Then sign in with your ${idWord} and the password you chose.`,
    "If you did not expect this email, you can ignore it.",
    "",
    "Talent Track Platform, powered by F.L.A.G.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:${SANS};font-size:17px;line-height:1.55;color:#1a1f2b;">
<p style="margin:0 0 24px;font-family:${HEADING};font-size:20px;font-weight:600;color:${BRAND};">Talent Track Platform</p>
<p style="margin:0 0 16px;">Hello ${esc(fullName)},</p>
<p style="margin:0 0 16px;">Your Talent Track Platform account is ready.</p>
<p style="margin:0 0 24px;">${esc(id.label)}: <strong>${esc(id.value)}</strong></p>
<p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:6px;">Choose your password</a></p>
<p style="margin:0 0 8px;font-size:15px;color:#475066;">The link can be used once, within ${INVITE_LIFETIME_HOURS} hours. If the button does not work, copy this address into your browser:</p>
<p style="margin:0 0 24px;font-size:15px;word-break:break-all;"><a href="${esc(link)}" style="color:${BRAND};">${esc(link)}</a></p>
<p style="margin:0 0 32px;font-size:15px;color:#475066;">Then sign in with your ${esc(idWord)} and the password you chose. If you did not expect this email, you can ignore it.</p>
<p style="margin:0;font-size:14px;color:#475066;border-top:1px solid #d9dde6;padding-top:16px;">Talent Track Platform, powered by F.L.A.G.</p>
</div></body></html>`;

  return { subject, text, html };
}
