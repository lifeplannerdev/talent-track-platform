import "server-only";

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type MailResult = { ok: true } | { ok: false };

/** Domain part of an address, for logs. Never log the full address, body or link. */
export function recipientDomain(to: string): string {
  const at = to.lastIndexOf("@");
  return at >= 0 ? to.slice(at + 1).toLowerCase() : "unknown";
}

/** Development transport: sends nothing, logs only the recipient's domain. */
export async function logTransport(message: MailMessage): Promise<MailResult> {
  console.info(`[mail] log transport: not sent, recipient domain ${recipientDomain(message.to)}`);
  return { ok: true };
}

/** Resend over HTTPS with fetch (no SDK). Never throws; logs the status code only. */
export async function resendTransport(message: MailMessage): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const missing = [!apiKey && "RESEND_API_KEY", !from && "MAIL_FROM"].filter(Boolean);
  if (missing.length > 0) {
    console.error(`[mail] resend transport not configured, missing ${missing.join(", ")}`);
    return { ok: false };
  }
  const domain = recipientDomain(message.to);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      console.error(`[mail] resend failed, status ${res.status}, recipient domain ${domain}`);
      return { ok: false };
    }
    console.info(`[mail] resend sent, recipient domain ${domain}`);
    return { ok: true };
  } catch {
    console.error(`[mail] resend request failed, recipient domain ${domain}`);
    return { ok: false };
  }
}
