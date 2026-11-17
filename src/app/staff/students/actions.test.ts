// Integration tests for the staff student actions against the LOCAL Supabase stack. Staff and
// student sessions are real (password sign-in with the anon key); only the Next.js request
// plumbing is replaced: createClient() returns the signed-in client of the test, redirect() throws.
// All passwords here are TEST values generated per run.
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
// The real service-role client, with its RPC calls observable (and one failure injectable).
const adminSpy = vi.hoisted(() => ({ rpcCalls: [] as { fn: string; args: unknown }[], failRevoke: false, failDelete: false }));
vi.mock("@/lib/supabase/admin", async () => {
  const { createClient: create } = await import("@supabase/supabase-js");
  return {
    createAdminClient: () => {
      const client = create(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const rpc = client.rpc.bind(client);
      (client as { rpc: unknown }).rpc = (fn: string, args?: Record<string, unknown>) => {
        adminSpy.rpcCalls.push({ fn, args });
        if (fn === "revoke_user_sessions" && adminSpy.failRevoke) {
          return Promise.resolve({ data: null, error: { message: "injected", code: "XX000" } });
        }
        return rpc(fn, args);
      };
      const deleteUser = client.auth.admin.deleteUser.bind(client.auth.admin);
      client.auth.admin.deleteUser = ((id: string) =>
        adminSpy.failDelete
          ? Promise.resolve({ data: { user: null }, error: { message: "injected", code: "unexpected_failure", status: 500 } })
          : deleteUser(id)) as typeof client.auth.admin.deleteUser;
      return client;
    },
  };
});

import { usernameToEmail } from "@/lib/auth/username";
import { STUDENT_CSV_MAX_BYTES } from "@/lib/csv/limits";
import { startAttempt } from "@/lib/attempts";
import {
  assignCurriculum,
  createStudent,
  deleteStudent,
  importStudents,
  previewStudentsImport,
  removeCurriculum,
  reorderCurriculums,
  resetPassword,
} from "./actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const prefix = `t8.${run}`;
const userIds: string[] = [];
const curriculumIds: string[] = [];
let staffClient: SupabaseClient;
let studentClient: SupabaseClient;
let studentId = "";
let studentEmail = "";
let studentPassword = "";
let staffId = "";
let tempCurriculum = "";
let tempCurriculum2 = "";
let tempSetId = "";

const PFLEGE = "Pflege Ausbildung";
const LIFE = "Life in Germany";

function testPassword() {
  return `test-${randomUUID()}`;
}

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

async function signIn(email: string, password: string): Promise<SupabaseClient | null> {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? null : client;
}

let counter = 0;
async function makeUser(role: "staff" | "student") {
  counter += 1;
  const username = `${prefix}.${role}${counter}`;
  const email = role === "staff" ? `${username}@staff.test` : usernameToEmail(username);
  const password = testPassword();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: `T8 ${role} ${counter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = await signIn(email, password);
  if (!client) throw new Error("sign-in failed");
  return { id: data.user.id, client, username, email, password };
}

async function profileId(username: string): Promise<string | null> {
  const { data } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
  return data?.id ?? null;
}

async function assignmentsOf(id: string) {
  const rows = await must(
    db.from("assignments").select("position, status, curriculums(name)").eq("student_id", id).order("position"),
  );
  return (rows as unknown as { position: number; status: string; curriculums: { name: string } }[]).map((r) => [
    r.curriculums.name,
    r.position,
  ]);
}

function asStaff() {
  session.client = staffClient;
}
function asStudent() {
  session.client = studentClient;
}

beforeAll(async () => {
  const staff = await makeUser("staff");
  staffClient = staff.client;
  staffId = staff.id;
  const student = await makeUser("student");
  studentClient = student.client;
  studentId = student.id;
  studentEmail = student.email;
  studentPassword = student.password;
  for (const name of [`T8 temp ${run}`, `T8 temp2 ${run}`]) {
    const c = await must(db.from("curriculums").insert({ name }).select("id").single());
    curriculumIds.push(c.id);
  }
  [tempCurriculum, tempCurriculum2] = curriculumIds;
  const set = await must(
    db
      .from("exam_sets")
      .insert({ curriculum_id: tempCurriculum, name: "T8 set", question_count: 1, time_limit_min: 10, pass_mark_percent: 50, max_attempts: 2 })
      .select("id")
      .single(),
  );
  tempSetId = set.id;
  const { error } = await db.from("questions").insert({
    exam_set_id: tempSetId,
    topic: "t",
    difficulty: "easy",
    stem_de: `Frage ${run}`,
    stem_en: `Question ${run}`,
    options: [
      { id: "a", de: "Ja", en: "Yes" },
      { id: "b", de: "Nein", en: "No" },
    ],
    correct_option_id: "a",
    status: "approved",
  });
  if (error) throw error;
});

afterAll(async () => {
  const created = await must(db.from("profiles").select("id").like("username", `${prefix}%`));
  for (const { id } of created) await db.auth.admin.deleteUser(id);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  for (const id of curriculumIds) await db.from("curriculums").delete().eq("id", id);
});

beforeEach(() => {
  session.client = null;
  adminSpy.rpcCalls.length = 0;
  adminSpy.failRevoke = false;
  adminSpy.failDelete = false;
});

describe("createStudent", () => {
  it("creates a loginable nursing student with Pflege Ausbildung (1) and Life in Germany (2)", async () => {
    asStaff();
    const username = `${prefix}.nurse`;
    const password = testPassword();
    const result = await createStudent({ username: username.toUpperCase(), fullName: "Nina Nurse", batch: "B7", track: "nursing", password });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain(password);

    const id = await profileId(username);
    expect(id).not.toBeNull();
    const profile = await must(db.from("profiles").select("role, full_name, batch, track").eq("id", id!).single());
    expect(profile).toEqual({ role: "student", full_name: "Nina Nurse", batch: "B7", track: "nursing" });
    expect(await assignmentsOf(id!)).toEqual([
      [PFLEGE, 1],
      [LIFE, 2],
    ]);
    const client = await signIn(usernameToEmail(username), password);
    expect(client).not.toBeNull();
    const { data: me } = await client!.from("profiles").select("username").single();
    expect(me?.username).toBe(username);
  });

  it("gives track other only Life in Germany and stores a blank batch as null", async () => {
    asStaff();
    const username = `${prefix}.other`;
    const password = testPassword();
    expect(await createStudent({ username, fullName: "Otto Other", batch: " ", track: "other", password })).toMatchObject({ ok: true });
    const id = (await profileId(username))!;
    expect(await assignmentsOf(id)).toEqual([[LIFE, 1]]);
    const profile = await must(db.from("profiles").select("batch").eq("id", id).single());
    expect(profile.batch).toBeNull();
    expect(await signIn(usernameToEmail(username), password)).not.toBeNull();
  });

  it("refuses a duplicate username cleanly without touching the existing user", async () => {
    asStaff();
    const username = `${prefix}.dup`;
    const first = testPassword();
    expect(await createStudent({ username, fullName: "First", batch: "", track: "other", password: first })).toMatchObject({ ok: true });
    const second = testPassword();
    const result = await createStudent({ username, fullName: "Second", batch: "", track: "nursing", password: second });
    expect(result).toEqual({ ok: false, message: `Username "${username}" is already taken` });
    expect(JSON.stringify(result)).not.toContain(second);

    const rows = await must(db.from("profiles").select("id, full_name").eq("username", username));
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe("First");
    expect(await assignmentsOf(rows[0].id)).toEqual([[LIFE, 1]]);
    expect(await signIn(usernameToEmail(username), first)).not.toBeNull();
    expect(await signIn(usernameToEmail(username), second)).toBeNull();
  });

  it("refuses a username already used by staff (profile clash) without creating an auth user", async () => {
    asStaff();
    const { data: staffProfile } = await db.from("profiles").select("username").eq("id", staffId).single();
    const result = await createStudent({ username: staffProfile!.username, fullName: "Clash", batch: "", track: "other", password: testPassword() });
    expect(result).toEqual({ ok: false, message: `Username "${staffProfile!.username}" is already taken` });
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.some((u) => u.email === usernameToEmail(staffProfile!.username))).toBe(false);
  });

  it("rejects invalid input and creates nothing", async () => {
    asStaff();
    const username = `${prefix}.short`;
    expect(await createStudent({ username, fullName: "Short", batch: "", track: "other", password: "short" })).toEqual({
      ok: false,
      message: "Password must be at least 8 characters",
    });
    expect(await createStudent({ username, fullName: "Bad", batch: "", track: "medicine", password: testPassword() })).toMatchObject({ ok: false });
    expect(await createStudent({ username: "bad name", fullName: "Bad", batch: "", track: "other", password: testPassword() })).toMatchObject({ ok: false });
    expect(await createStudent(null as never)).toMatchObject({ ok: false });
    expect(await profileId(username)).toBeNull();
  });

  it("finds the default curriculums by their fixed ids, so renaming one does not break student creation", async () => {
    asStaff();
    const username = `${prefix}.renamed`;
    const renamed = `${LIFE} (renamed ${run})`;
    const { error } = await db.from("curriculums").update({ name: renamed }).eq("name", LIFE);
    if (error) throw error;
    try {
      expect(await createStudent({ username, fullName: "Renamed", batch: "", track: "other", password: testPassword() })).toMatchObject({ ok: true });
      expect(await assignmentsOf((await profileId(username))!)).toEqual([[renamed, 1]]);
    } finally {
      await db.from("curriculums").update({ name: LIFE }).eq("name", renamed);
    }
  });

  it("refuses a password with leading or trailing spaces", async () => {
    asStaff();
    const username = `${prefix}.spaces`;
    expect(await createStudent({ username, fullName: "Spaces", batch: "", track: "other", password: ` ${testPassword()}` })).toEqual({
      ok: false,
      message: "Password must not start or end with a space",
    });
    expect(await profileId(username)).toBeNull();
  });
});

describe("importStudents", () => {
  it("previews row errors (with existing usernames) and never returns passwords", async () => {
    asStaff();
    const { data: existing } = await db.from("profiles").select("username").eq("id", studentId).single();
    const pw = testPassword();
    const csv = [
      "username,full_name,batch,track,password",
      `${prefix}.imp1,Imp One,B1,nursing,${pw}`,
      `${existing!.username},Taken,B1,other,${pw}x`,
      `${prefix}.imp3,Imp Three,B1,weird,${pw}y`,
    ].join("\n");
    const preview = await previewStudentsImport(csv);
    expect(preview).toEqual({
      ok: true,
      rows: [{ row: 1, username: `${prefix}.imp1`, fullName: "Imp One", batch: "B1", track: "nursing" }],
      errors: [
        { row: 2, message: `Username "${existing!.username}" is already taken` },
        { row: 3, message: 'Unknown track "weird" (must be nursing or other)' },
      ],
    });
    expect(JSON.stringify(preview)).not.toContain(pw);

    // All-or-nothing validation: any error, nothing is created.
    const result = await importStudents(csv);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(pw);
    expect(await profileId(`${prefix}.imp1`)).toBeNull();
  });

  it("creates every row of a valid file with curriculums by track, loginable", async () => {
    asStaff();
    const pw1 = testPassword();
    const pw2 = testPassword();
    const csv = ["﻿username;full_name;batch;track;password", `${prefix}.bulk1;Bulk Eins;B9;nursing;${pw1}`, "", `${prefix}.bulk2;Bulk Zwei;B9;other;${pw2}`].join("\r\n");
    const result = await importStudents(csv);
    expect(result).toEqual({
      ok: true,
      created: [
        { row: 1, username: `${prefix}.bulk1` },
        { row: 3, username: `${prefix}.bulk2` },
      ],
      failed: [],
    });
    expect(JSON.stringify(result)).not.toContain(pw1);
    expect(await assignmentsOf((await profileId(`${prefix}.bulk1`))!)).toEqual([
      [PFLEGE, 1],
      [LIFE, 2],
    ]);
    expect(await assignmentsOf((await profileId(`${prefix}.bulk2`))!)).toEqual([[LIFE, 1]]);
    expect(await signIn(usernameToEmail(`${prefix}.bulk2`), pw2)).not.toBeNull();

    // Re-running the same file creates nothing twice: every row is reported as taken.
    const again = await importStudents(csv);
    expect(again).toMatchObject({ ok: false });
    expect((again as { errors: unknown[] }).errors).toHaveLength(2);
  });
});

describe("resetPassword", () => {
  it("changes the password, ends every existing session of the student, and the old password stops working", async () => {
    asStaff();
    const target = await makeUser("student");
    const second = await signIn(target.email, target.password);
    expect((await target.client.auth.getUser()).error).toBeNull();
    const next = testPassword();
    const result = await resetPassword(target.id, next);
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(next);
    // Sessions signed in before the reset are rejected by the auth server at once.
    const after = await target.client.auth.getUser();
    expect(after.error).not.toBeNull();
    expect(after.data.user).toBeNull();
    expect((await second!.auth.getUser()).error).not.toBeNull();
    // Their refresh tokens are gone too.
    expect((await target.client.auth.refreshSession()).error).not.toBeNull();
    expect(await signIn(target.email, target.password)).toBeNull();
    expect(await signIn(target.email, next)).not.toBeNull();
    // Sessions are ended explicitly through revoke_user_sessions (service role), not left to the
    // auth server's own behaviour, which differs between versions.
    expect(adminSpy.rpcCalls).toContainEqual({ fn: "revoke_user_sessions", args: { p_user_id: target.id } });
  });

  it("says the password was changed when the sessions could not be ended, without the password", async () => {
    asStaff();
    const target = await makeUser("student");
    const next = testPassword();
    adminSpy.failRevoke = true;
    try {
      const result = await resetPassword(target.id, next);
      expect(result).toEqual({
        ok: false,
        message: "The password was changed, but the student's existing sessions could not be ended. Please try again or contact the administrator.",
      });
      expect(JSON.stringify(result)).not.toContain(next);
      expect(await signIn(target.email, next)).not.toBeNull();
    } finally {
      adminSpy.failRevoke = false;
    }
  });

  it("refuses short or space-padded passwords and staff accounts", async () => {
    asStaff();
    expect(await resetPassword(studentId, "short")).toEqual({ ok: false, message: "Password must be at least 8 characters" });
    expect(await resetPassword(studentId, `${testPassword()} `)).toEqual({ ok: false, message: "Password must not start or end with a space" });
    expect(await resetPassword(staffId, testPassword())).toEqual({ ok: false, message: "Student not found" });
    expect(await resetPassword("not-a-uuid", testPassword())).toEqual({ ok: false, message: "Student not found" });
  });
});

describe("CSV size cap (bytes)", () => {
  const header = "username,full_name,batch,track,password\n";
  it("accepts a file just under 1 MB and refuses one over 1 MB in bytes", async () => {
    asStaff();
    const line = "x,A,,other,test-pass-1\n";
    const under = header + line.repeat(Math.floor((STUDENT_CSV_MAX_BYTES - header.length - 1) / line.length));
    expect(new TextEncoder().encode(under).length).toBeLessThanOrEqual(STUDENT_CSV_MAX_BYTES);
    const preview = await previewStudentsImport(under);
    expect(preview).toMatchObject({ ok: true, rows: [] });
    // Fewer characters than the cap, but more bytes (umlauts are 2 bytes in UTF-8).
    const over = header + "ä".repeat(Math.ceil(STUDENT_CSV_MAX_BYTES / 2) + 10);
    expect(over.length).toBeLessThan(STUDENT_CSV_MAX_BYTES);
    expect(await previewStudentsImport(over)).toEqual({ ok: false, message: "The file is too large (at most 1 MB)." });
    expect(await importStudents(over)).toMatchObject({ ok: false, message: "The file is too large (at most 1 MB)." });
  });
});

describe("curriculum assignments", () => {
  it("assigns at the next position, refuses a duplicate, and reorders", async () => {
    asStaff();
    const s = await makeUser("student");
    expect(await assignCurriculum(s.id, tempCurriculum)).toEqual({ ok: true });
    expect(await assignCurriculum(s.id, tempCurriculum2)).toEqual({ ok: true });
    expect(await assignCurriculum(s.id, tempCurriculum)).toEqual({ ok: false, message: "This curriculum is already assigned" });
    expect(await assignmentsOf(s.id)).toEqual([
      [`T8 temp ${run}`, 1],
      [`T8 temp2 ${run}`, 2],
    ]);

    expect(await reorderCurriculums(s.id, [tempCurriculum2, tempCurriculum])).toEqual({ ok: true });
    expect(await assignmentsOf(s.id)).toEqual([
      [`T8 temp2 ${run}`, 1],
      [`T8 temp ${run}`, 2],
    ]);
    // The list must be exactly the student's curriculums.
    expect(await reorderCurriculums(s.id, [tempCurriculum])).toMatchObject({ ok: false });
    expect(await reorderCurriculums(s.id, [tempCurriculum, tempCurriculum])).toMatchObject({ ok: false });
  });

  it("removing a curriculum with attempts needs the confirm flag; attempts stay for the record", async () => {
    asStaff();
    const s = await makeUser("student");
    expect(await assignCurriculum(s.id, tempCurriculum)).toEqual({ ok: true });
    const { error } = await db.from("attempt_grants").insert({ student_id: s.id, exam_set_id: tempSetId });
    if (error) throw error;
    const { attemptId } = await startAttempt(s.id, tempSetId);
    await db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: false });

    expect(await removeCurriculum(s.id, tempCurriculum)).toEqual({
      ok: false,
      code: "has_attempts",
      message: "This student has 1 attempt in this curriculum. Confirm to remove the assignment; the attempts are kept.",
    });
    expect(await assignmentsOf(s.id)).toHaveLength(1);

    expect(await removeCurriculum(s.id, tempCurriculum, { confirm: true })).toEqual({ ok: true });
    expect(await assignmentsOf(s.id)).toEqual([]);
    const attempts = await must(db.from("attempts").select("id").eq("student_id", s.id));
    expect(attempts).toHaveLength(1);
  });

  it("refuses while an attempt is in progress, even with confirm; without attempts removes at once and drops unused grants", async () => {
    asStaff();
    const s = await makeUser("student");
    await assignCurriculum(s.id, tempCurriculum);
    await db.from("attempt_grants").insert({ student_id: s.id, exam_set_id: tempSetId });
    await startAttempt(s.id, tempSetId);
    expect(await removeCurriculum(s.id, tempCurriculum, { confirm: true })).toMatchObject({ ok: false, code: "in_progress" });

    const t = await makeUser("student");
    await assignCurriculum(t.id, tempCurriculum);
    await db.from("attempt_grants").insert({ student_id: t.id, exam_set_id: tempSetId });
    expect(await removeCurriculum(t.id, tempCurriculum)).toEqual({ ok: true });
    expect(await assignmentsOf(t.id)).toEqual([]);
    const grants = await must(db.from("attempt_grants").select("id").eq("student_id", t.id));
    expect(grants).toEqual([]);
  });
});

describe("deleteStudent (DPDP delete path)", () => {
  it("needs the username typed exactly, then removes the account, profile, assignments, grants and attempts", async () => {
    asStaff();
    const s = await makeUser("student");
    await assignCurriculum(s.id, tempCurriculum);
    await db.from("attempt_grants").insert({ student_id: s.id, exam_set_id: tempSetId });
    const { attemptId } = await startAttempt(s.id, tempSetId);
    await db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: false });

    expect(await deleteStudent(s.id, { confirmUsername: "" })).toMatchObject({ ok: false, code: "confirm" });
    expect(await deleteStudent(s.id, { confirmUsername: `${s.username}x` })).toMatchObject({ ok: false, code: "confirm" });
    expect(await profileId(s.username)).toBe(s.id);

    expect(await deleteStudent(s.id, { confirmUsername: s.username.toUpperCase() })).toEqual({ ok: true });
    expect(await profileId(s.username)).toBeNull();
    const { data: authUser } = await db.auth.admin.getUserById(s.id);
    expect(authUser.user).toBeNull();
    expect(await must(db.from("attempts").select("id").eq("student_id", s.id))).toEqual([]);
    expect(await must(db.from("assignments").select("id").eq("student_id", s.id))).toEqual([]);
    expect(await signIn(s.email, s.password)).toBeNull();
  });

  it("refuses while the student is taking an exam", async () => {
    asStaff();
    const s = await makeUser("student");
    await assignCurriculum(s.id, tempCurriculum);
    await db.from("attempt_grants").insert({ student_id: s.id, exam_set_id: tempSetId });
    await startAttempt(s.id, tempSetId);
    expect(await deleteStudent(s.id, { confirmUsername: s.username })).toMatchObject({ ok: false, code: "in_progress" });
    expect(await profileId(s.username)).toBe(s.id);
  });

  it("refuses staff accounts and unknown ids, and reports a failed delete", async () => {
    asStaff();
    const staff = await makeUser("staff");
    expect(await deleteStudent(staff.id, { confirmUsername: staff.username })).toEqual({ ok: false, message: "Student not found" });
    expect(await deleteStudent("nope", { confirmUsername: "nope" })).toEqual({ ok: false, message: "Student not found" });
    const s = await makeUser("student");
    adminSpy.failDelete = true;
    expect(await deleteStudent(s.id, { confirmUsername: s.username })).toMatchObject({ ok: false });
    expect(await profileId(s.username)).toBe(s.id);
  });

  it("a student session is redirected and nothing is deleted", async () => {
    asStudent();
    const s = await makeUser("student");
    await expect(deleteStudent(s.id, { confirmUsername: s.username })).rejects.toThrow(/REDIRECT/);
    expect(await profileId(s.username)).toBe(s.id);
  });
});

describe("a student session cannot use any student management action", () => {
  it("every action redirects and nothing changes", async () => {
    asStudent();
    const username = `${prefix}.bystudent`;
    const pw = testPassword();
    await expect(createStudent({ username, fullName: "X", batch: "", track: "other", password: pw })).rejects.toThrow(/REDIRECT/);
    await expect(importStudents(`username,full_name,batch,track,password\n${username},X,,other,${pw}`)).rejects.toThrow(/REDIRECT/);
    await expect(previewStudentsImport("username,full_name,batch,track,password")).rejects.toThrow(/REDIRECT/);
    await expect(resetPassword(studentId, pw)).rejects.toThrow(/REDIRECT/);
    // The student's own password still works and the new one does not.
    expect(await signIn(studentEmail, studentPassword)).not.toBeNull();
    expect(await signIn(studentEmail, pw)).toBeNull();
    await expect(assignCurriculum(studentId, tempCurriculum)).rejects.toThrow(/REDIRECT/);
    await expect(removeCurriculum(studentId, tempCurriculum, { confirm: true })).rejects.toThrow(/REDIRECT/);
    await expect(reorderCurriculums(studentId, [])).rejects.toThrow(/REDIRECT/);
    expect(await profileId(username)).toBeNull();
    expect(await assignmentsOf(studentId)).toEqual([]);
  });

  it("anonymous callers are redirected to login", async () => {
    session.client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    await expect(resetPassword(studentId, testPassword())).rejects.toThrow(/REDIRECT \/login/);
  });
});
