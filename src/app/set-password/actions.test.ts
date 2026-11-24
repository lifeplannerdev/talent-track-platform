// Integration test against the LOCAL Supabase stack: a real invite token is made with the service
// role (buildInviteLink, the code behind createInviteLink), the action runs with a real anon
// client in place of the cookie-bound server client. All passwords are TEST values.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ makeClient: null as null | (() => unknown) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.makeClient!() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

import { usernameToEmail } from "@/lib/auth/username";
import { buildInviteLink } from "@/lib/invite-link";
import { setPasswordAction } from "./actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const username = `t7.${randomUUID().slice(0, 8)}`;
const oldPassword = `old-${randomUUID()}`;
const GENERIC = "This link is no longer valid. Ask your trainer to send you a new one.";
let userId = "";

async function freshToken(): Promise<string> {
  const made = await buildInviteLink(admin, userId, "http://localhost:3000");
  if (!made.ok) throw new Error("no link");
  return new globalThis.URL(made.link).searchParams.get("token_hash")!;
}
async function canSignIn(password: string) {
  const { error } = await anon().auth.signInWithPassword({ email: usernameToEmail(username), password });
  return !error;
}

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password: oldPassword,
    email_confirm: true,
    app_metadata: { role: "student", username, full_name: "T7 Student", track: "other" },
  });
  if (error) throw error;
  userId = data.user.id;
});
afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});
afterEach(() => {
  session.makeClient = null;
  vi.restoreAllMocks();
});

describe("setPasswordAction", () => {
  it("a weak password shows the checkPassword message and does not use up the token", async () => {
    session.makeClient = anon;
    const token = await freshToken();
    const weak = await setPasswordAction({ tokenHash: token, password: "short" });
    expect(weak).toEqual({ ok: false, message: expect.stringMatching(/8 characters/) });
    // The same token still works afterwards.
    const good = `new-${randomUUID()}`;
    await expect(setPasswordAction({ tokenHash: token, password: good })).rejects.toThrow("REDIRECT /login");
    expect(await canSignIn(good)).toBe(true);
    expect(await canSignIn(oldPassword)).toBe(false);
  });

  it("a used token, a garbage token and an empty token give one generic message", async () => {
    session.makeClient = anon;
    const logs = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {})];
    const token = await freshToken();
    const password = `new-${randomUUID()}`;
    await expect(setPasswordAction({ tokenHash: token, password })).rejects.toThrow("REDIRECT /login");
    const reused = await setPasswordAction({ tokenHash: token, password: `other-${randomUUID()}` });
    const garbage = await setPasswordAction({ tokenHash: "not-a-token", password });
    const empty = await setPasswordAction({ tokenHash: "", password });
    for (const r of [reused, garbage, empty]) expect(r).toEqual({ ok: false, message: GENERIC });
    const logged = JSON.stringify(logs.flatMap((l) => l.mock.calls));
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(password);
  });

  it("ends the other sessions of the account", async () => {
    const other = anon();
    const password = `pw-${randomUUID()}`;
    await admin.auth.admin.updateUserById(userId, { password });
    expect((await other.auth.signInWithPassword({ email: usernameToEmail(username), password })).error).toBeNull();
    session.makeClient = anon;
    const token = await freshToken();
    await expect(setPasswordAction({ tokenHash: token, password: `new-${randomUUID()}` })).rejects.toThrow("REDIRECT /login");
    // The old session's refresh token no longer works.
    const { error } = await other.auth.refreshSession();
    expect(error).not.toBeNull();
  });
});
