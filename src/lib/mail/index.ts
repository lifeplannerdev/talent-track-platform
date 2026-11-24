import "server-only";
import { logTransport, resendTransport, recipientDomain } from "./transports";
import type { MailMessage, MailResult } from "./transports";

export type { MailMessage, MailResult };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function transportName(): string {
  const configured = process.env.MAIL_TRANSPORT?.trim();
  if (configured) return configured;
  // Default: log outside production; in production a transport must be chosen on purpose.
  return process.env.NODE_ENV === "production" ? "" : "log";
}

/**
 * Sends one email through the configured transport (MAIL_TRANSPORT: "log" or "resend").
 * Never throws. Logs only the recipient's domain and the outcome, never the body or a link.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  try {
    if (!EMAIL.test(message.to)) {
      console.error("[mail] refused, recipient is not a valid address");
      return { ok: false };
    }
    const name = transportName();
    if (name === "log") return await logTransport(message);
    if (name === "resend") return await resendTransport(message);
    console.error(
      name
        ? `[mail] unknown MAIL_TRANSPORT "${name}", recipient domain ${recipientDomain(message.to)}`
        : `[mail] MAIL_TRANSPORT is not set in production, recipient domain ${recipientDomain(message.to)}`,
    );
    return { ok: false };
  } catch {
    console.error("[mail] unexpected failure while sending");
    return { ok: false };
  }
}
