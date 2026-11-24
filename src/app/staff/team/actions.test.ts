// Integration tests for the admin team actions against the LOCAL Supabase stack. Sessions are
// real (password sign-in with the anon key); only the Next.js plumbing is replaced. Passwords
// here are TEST values generated per run.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const mailSpy = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string; html: string }[], ok: true }));
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string; subject: string; text: string; html: string }) => {
    mailSpy.sent.push(m);
    return { ok: mailSpy.ok };
  },
}));
// The real service-role client, with failures injectable at the three deactivation steps.
const adminSpy = vi.hoisted(() => ({ failBan: false, failRevoke: false, calls: [] as string[] }));
vi.mock("@/lib/supabase/admin", async () => {
  const { createClient: create } = await import("@supabase/supabase-js");
  return {
    createAdminClient: () => {
      const client = create(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const rpc = client.rpc.bind(client);
      (client as { rpc: unknown }).rpc = (fn: string, args?: Record<string, unknown>) => {
        adminSpy.calls.push(`rpc:${fn}`);
        if (fn === "revoke_user_sessions" && adminSpy.failRevoke) {
          return Promise.resolve({ data: null, error: { message: "injected", code: "XX000" } });
        }
        return rpc(fn, args);
      };
      const update = client.auth.admin.updateUserById.bind(client.auth.admin);
      client.auth.admin.updateUserById = ((id: string, attrs: { ban_duration?: string }) => {
        if ("ban_duration" in attrs) adminSpy.calls.push(`ban:${attrs.ban_duration}`);
        if (attrs.ban_duration && attrs.ban_duration !== "none" && adminSpy.failBan) {
          return Promise.resolve({ data: { user: null }, error: { message: "injected", code: "unexpected_failure", status: 500 } });
        }
        return update(id, attrs);
      }) as typeof client.auth.admin.updateUserById;
      return client;
    },
  };
});

import { usernameToEmail } from "@/lib/auth/username";
import { createTrainer, reassignStudents, resendTrainerInvite, setTrainerActive } from "./actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

const run = randomUUID().slice(0, 8);
const prefix = `t9.${run}`;
const userIds: string[] = [];
let counter = 0;

function testPassword() {
  return `test-${randomUUID()}`;
}

async function signIn(email: string, password: string): Promise<SupabaseClient | null> {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? null : client;
}

async function makeUser(role: "admin" | "trainer" | "student", trainerId?: string) {
  counter += 1;
  const username = `${prefix}.${role}${counter}`;
  const email = role === "student" ? usernameToEmail(username) : `${username}@staff.test`;
  const password = testPassword();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: `T9 ${role} ${counter}`, ...(trainerId ? { trainer_id: trainerId } : {}) },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = await signIn(email, password);
  if (!client) throw new Error("sign-in failed");
  return { id: data.user.id, client, username, email, password };
}

async function profile(id: string) {
  const { data } = await db.from("profiles").select("id, role, username, full_name, active, trainer_id").eq("id", id).maybeSingle();
  return data;
}

let admin: Awaited<ReturnType<typeof makeUser>>;
let trainer: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("admin");
  trainer = await makeUser("trainer");
});

afterAll(async () => {
  // Students first (profiles.trainer_id restricts deleting a trainer who still has students).
  const { data: made } = await db.from("profiles").select("id, role").like("username", `${prefix}%`);
  for (const p of (made ?? []).filter((p) => p.role === "student")) await db.auth.admin.deleteUser(p.id);
  for (const p of (made ?? []).filter((p) => p.role !== "student")) await db.auth.admin.deleteUser(p.id);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

beforeEach(() => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  mailSpy.sent = [];
  mailSpy.ok = true;
  adminSpy.failBan = false;
  adminSpy.failRevoke = false;
  adminSpy.calls = [];
  session.client = admin.client;
});

const ID = "22222222-2222-4222-8222-222222222222";

describe("team actions are admin only", () => {
  it("a trainer is redirected from every action and nothing changes", async () => {
    session.client = trainer.client;
    const before = (await db.from("profiles").select("id", { count: "exact", head: true })).count;
    await expect(createTrainer({ email: `x.${run}@example.test`, username: `${prefix}.nope`, fullName: "Nope" })).rejects.toThrow("REDIRECT /staff");
    await expect(resendTrainerInvite(trainer.id)).rejects.toThrow("REDIRECT /staff");
    await expect(setTrainerActive(trainer.id, false)).rejects.toThrow("REDIRECT /staff");
    await expect(reassignStudents({ fromTrainerId: trainer.id, toTrainerId: ID })).rejects.toThrow("REDIRECT /staff");
    expect((await db.from("profiles").select("id", { count: "exact", head: true })).count).toBe(before);
    expect((await profile(trainer.id))?.active).toBe(true);
    expect(mailSpy.sent).toEqual([]);
  });
});

describe("createTrainer", () => {
  it("creates a trainer with the real email, mails a set-password link and never returns a password", async () => {
    const email = `new.${run}@example.test`;
    const username = `${prefix}.newtrainer`;
    const result = await createTrainer({ email: ` ${email.toUpperCase()} `, username, fullName: "New Trainer" });
    expect(result).toMatchObject({ ok: true, invite: "sent" });
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(["invite", "ok", "trainerId"]);
    expect(await profile(result.trainerId)).toMatchObject({ role: "trainer", username, full_name: "New Trainer", active: true });
    const { data: auth } = await db.auth.admin.getUserById(result.trainerId);
    expect(auth.user?.email).toBe(email);
    expect(auth.user?.app_metadata).toMatchObject({ role: "trainer" });
    expect(mailSpy.sent).toHaveLength(1);
    expect(mailSpy.sent[0].to).toBe(email);
    expect(mailSpy.sent[0].text).toMatch(/\/set-password\?token_hash=/);
    expect(mailSpy.sent[0].text).toContain(email); // trainers sign in with the email
    expect(mailSpy.sent[0].text.toLowerCase()).toContain("sign in with your email address");
  });

  it("keeps the account when the mail fails, and the invite can be resent", async () => {
    mailSpy.ok = false;
    const result = await createTrainer({ email: `mailfail.${run}@example.test`, username: `${prefix}.mailfail`, fullName: "Mail Fail" });
    expect(result).toMatchObject({ ok: true, invite: "failed" });
    if (!result.ok) return;
    expect((await profile(result.trainerId))?.role).toBe("trainer");
    mailSpy.ok = true;
    mailSpy.sent = [];
    expect(await resendTrainerInvite(result.trainerId)).toEqual({ ok: true });
    expect(mailSpy.sent).toHaveLength(1);
    expect(mailSpy.sent[0].to).toBe(`mailfail.${run}@example.test`);
  });

  it("refuses bad input, a taken username and a taken email without creating anything", async () => {
    const taken = await createTrainer({ email: `dup1.${run}@example.test`, username: `${prefix}.dup`, fullName: "Dup" });
    expect(taken.ok).toBe(true);
    expect(await createTrainer({ email: "nope", username: `${prefix}.bad1`, fullName: "X" })).toMatchObject({ ok: false });
    expect(await createTrainer({ email: `ok.${run}@example.test`, username: "a b", fullName: "X" })).toMatchObject({ ok: false });
    expect(await createTrainer({ email: `ok.${run}@example.test`, username: `${prefix}.bad2`, fullName: "  " })).toMatchObject({ ok: false });
    const sameName = await createTrainer({ email: `dup2.${run}@example.test`, username: `${prefix}.dup`, fullName: "Dup" });
    expect(sameName).toMatchObject({ ok: false });
    const sameEmail = await createTrainer({ email: `dup1.${run}@example.test`, username: `${prefix}.dup3`, fullName: "Dup" });
    expect(sameEmail).toMatchObject({ ok: false });
    const { data } = await db.from("profiles").select("id").in("username", [`${prefix}.bad1`, `${prefix}.bad2`, `${prefix}.dup3`]);
    expect(data).toEqual([]);
  });

  it("cannot resend to someone who is not a trainer", async () => {
    const student = await makeUser("student");
    expect(await resendTrainerInvite(student.id)).toMatchObject({ ok: false });
    expect(await resendTrainerInvite("nope")).toMatchObject({ ok: false });
    expect(mailSpy.sent).toEqual([]);
  });
});

describe("reassignStudents", () => {
  it("moves every student of one trainer to an active trainer in one update", async () => {
    const from = await makeUser("trainer");
    const to = await makeUser("trainer");
    const s1 = await makeUser("student", from.id);
    const s2 = await makeUser("student", from.id);
    const other = await makeUser("student", to.id);
    const r = await reassignStudents({ fromTrainerId: from.id, toTrainerId: to.id });
    expect(r).toEqual({ ok: true, moved: 2 });
    expect((await profile(s1.id))?.trainer_id).toBe(to.id);
    expect((await profile(s2.id))?.trainer_id).toBe(to.id);
    expect((await profile(other.id))?.trainer_id).toBe(to.id);
  });

  it("validates both ends: trainers only, the target active, not the same one", async () => {
    const from = await makeUser("trainer");
    const to = await makeUser("trainer");
    const s = await makeUser("student", from.id);
    expect(await reassignStudents({ fromTrainerId: from.id, toTrainerId: from.id })).toMatchObject({ ok: false });
    expect(await reassignStudents({ fromTrainerId: from.id, toTrainerId: admin.id })).toMatchObject({ ok: false });
    expect(await reassignStudents({ fromTrainerId: admin.id, toTrainerId: to.id })).toMatchObject({ ok: false });
    expect(await reassignStudents({ fromTrainerId: "nope", toTrainerId: to.id })).toMatchObject({ ok: false });
    await db.from("profiles").update({ active: false }).eq("id", to.id);
    expect(await reassignStudents({ fromTrainerId: from.id, toTrainerId: to.id })).toMatchObject({ ok: false });
    expect((await profile(s.id))?.trainer_id).toBe(from.id);
  });
});

describe("setTrainerActive", () => {
  it("refuses while the trainer has students, then deactivates after reassignment", async () => {
    const t = await makeUser("trainer");
    const heir = await makeUser("trainer");
    await makeUser("student", t.id);
    const refused = await setTrainerActive(t.id, false);
    expect(refused).toMatchObject({ ok: false });
    expect((await profile(t.id))?.active).toBe(true);
    expect(adminSpy.calls).toEqual([]);

    expect(await reassignStudents({ fromTrainerId: t.id, toTrainerId: heir.id })).toMatchObject({ ok: true });
    expect(await setTrainerActive(t.id, false)).toEqual({ ok: true });
    expect((await profile(t.id))?.active).toBe(false);
  });

  it("ends existing sessions and blocks password sign-in, then reactivation restores both", async () => {
    const t = await makeUser("trainer");
    expect((await t.client.auth.getUser()).data.user?.id).toBe(t.id);

    expect(await setTrainerActive(t.id, false)).toEqual({ ok: true });
    // Active flag first, then ban, then session revoke: never banned while still marked active.
    expect(adminSpy.calls).toEqual([expect.stringMatching(/^ban:\d+h$/), "rpc:revoke_user_sessions"]);
    expect((await profile(t.id))?.active).toBe(false);
    expect((await t.client.auth.getUser()).error).not.toBeNull();
    expect(await signIn(t.email, t.password)).toBeNull();

    expect(await setTrainerActive(t.id, true)).toEqual({ ok: true });
    expect(adminSpy.calls.slice(-1)).toEqual(["ban:none"]);
    expect((await profile(t.id))?.active).toBe(true);
    expect(await signIn(t.email, t.password)).not.toBeNull();
  });

  it("a failed ban leaves the account inactive (never banned-but-active) and says so", async () => {
    const t = await makeUser("trainer");
    adminSpy.failBan = true;
    const r = await setTrainerActive(t.id, false);
    expect(r).toMatchObject({ ok: false });
    expect((await profile(t.id))?.active).toBe(false);
  });

  it("a failed session revoke is reported, and the account stays deactivated and banned", async () => {
    const t = await makeUser("trainer");
    adminSpy.failRevoke = true;
    const r = await setTrainerActive(t.id, false);
    expect(r).toMatchObject({ ok: false });
    expect((await profile(t.id))?.active).toBe(false);
    expect(await signIn(t.email, t.password)).toBeNull();
  });

  it("only trainers can be switched: an admin, a student or a bad id is refused", async () => {
    const student = await makeUser("student");
    expect(await setTrainerActive(admin.id, false)).toMatchObject({ ok: false });
    expect(await setTrainerActive(student.id, false)).toMatchObject({ ok: false });
    expect(await setTrainerActive("nope", false)).toMatchObject({ ok: false });
    expect((await profile(admin.id))?.active).toBe(true);
  });
});
