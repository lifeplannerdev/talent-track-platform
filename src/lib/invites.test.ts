import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests with a fake admin client and a fake sendMail: nothing is sent, no database is used.
const fake = vi.hoisted(() => ({
  contactEmail: "student@example.com" as string | null,
  authEmail: "anu.menon@students.talenttrack.internal" as string | null,
  generateFails: false,
  throwOnGenerate: false,
  generateCalls: [] as unknown[],
  sent: [] as { to: string; subject: string; text: string; html: string }[],
  sendResult: { ok: true } as { ok: boolean },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === "student_details") {
            return { data: fake.contactEmail ? { contact_email: fake.contactEmail } : null, error: null };
          }
          return { data: { full_name: "Anu Menon", username: "anu.menon" }, error: null };
        },
      };
      return chain;
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: fake.authEmail ? { id: "u1", email: fake.authEmail } : null },
          error: null,
        }),
        generateLink: async (params: unknown) => {
          if (fake.throwOnGenerate) throw new Error("boom");
          fake.generateCalls.push(params);
          return fake.generateFails
            ? { data: { properties: null, user: null }, error: { message: "boom" } }
            : { data: { properties: { hashed_token: "HASHEDTOKEN" } }, error: null };
        },
      },
    },
  }),
}));
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string; subject: string; text: string; html: string }) => {
    fake.sent.push(m);
    return fake.sendResult;
  },
}));

import { INVITE_LIFETIME_DAYS, createInviteLink, sendInvite } from "./invites";
import { buildInviteMail } from "./mail/invite-template";

beforeEach(() => {
  fake.contactEmail = "student@example.com";
  fake.authEmail = "anu.menon@students.talenttrack.internal";
  fake.generateFails = false;
  fake.throwOnGenerate = false;
  fake.generateCalls.length = 0;
  fake.sent.length = 0;
  fake.sendResult = { ok: true };
  vi.stubEnv("APP_URL", "https://app.example.com/");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("createInviteLink", () => {
  it("generates a recovery link for the auth user's own email, without a double slash", async () => {
    const result = await createInviteLink(USER_ID);
    expect(result).toEqual({ ok: true, link: "https://app.example.com/set-password?token_hash=HASHEDTOKEN" });
    expect(fake.generateCalls).toEqual([{ type: "recovery", email: fake.authEmail }]);
  });

  it("returns ok false when the user, the link or APP_URL is missing", async () => {
    fake.authEmail = null;
    expect(await createInviteLink(USER_ID)).toEqual({ ok: false });
    fake.authEmail = "a@b.test";
    fake.generateFails = true;
    expect(await createInviteLink(USER_ID)).toEqual({ ok: false });
    fake.generateFails = false;
    vi.stubEnv("APP_URL", "");
    expect(await createInviteLink(USER_ID)).toEqual({ ok: false });
  });

  it("url-encodes the token", async () => {
    const result = await createInviteLink(USER_ID);
    expect(result.ok && new URL(result.link).searchParams.get("token_hash")).toBe("HASHEDTOKEN");
  });
});

describe("sendInvite", () => {
  it("is skipped when the student has no contact email, and sends nothing", async () => {
    fake.contactEmail = null;
    expect(await sendInvite(USER_ID)).toBe("skipped");
    expect(fake.sent).toHaveLength(0);
    expect(fake.generateCalls).toHaveLength(0);
  });

  it("sends the mail to the contact email and returns only 'sent'", async () => {
    const result = await sendInvite(USER_ID);
    expect(result).toBe("sent");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].to).toBe("student@example.com");
    expect(fake.sent[0].text).toContain("https://app.example.com/set-password?token_hash=HASHEDTOKEN");
    expect(JSON.stringify(result)).not.toContain("HASHEDTOKEN");
  });

  it("is 'failed' when sendMail fails, and never logs the link", async () => {
    fake.sendResult = { ok: false };
    expect(await sendInvite(USER_ID)).toBe("failed");
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("HASHEDTOKEN");
  });

  it("is 'failed' when the link cannot be made", async () => {
    fake.generateFails = true;
    expect(await sendInvite(USER_ID)).toBe("failed");
    expect(fake.sent).toHaveLength(0);
  });

  it("is 'failed', not a throw, for a bad APP_URL (the template refuses a non-http link)", async () => {
    vi.stubEnv("APP_URL", "not-a-url");
    await expect(sendInvite(USER_ID)).resolves.toBe("failed");
    expect(fake.sent).toHaveLength(0);
  });

  it("is 'failed', not a throw, when the admin client itself throws", async () => {
    fake.throwOnGenerate = true;
    await expect(sendInvite(USER_ID)).resolves.toBe("failed");
    expect(fake.sent).toHaveLength(0);
  });
});

describe("invite lifetime", () => {
  it("the mail template states the exported lifetime", () => {
    const mail = buildInviteMail({ fullName: "A", username: "a", link: "https://x.test/set-password?token_hash=t" });
    expect(INVITE_LIFETIME_DAYS).toBe(7);
    expect(mail.text).toContain(`expires in ${INVITE_LIFETIME_DAYS} days`);
    expect(mail.html).toContain(`expires in ${INVITE_LIFETIME_DAYS} days`);
  });

  it("local Supabase Auth otp_expiry matches it (production: raise the dashboard value to the same)", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    const match = config.match(/^\s*otp_expiry\s*=\s*(\d+)/m);
    expect(Number(match?.[1])).toBe(INVITE_LIFETIME_DAYS * 24 * 60 * 60);
  });
});
