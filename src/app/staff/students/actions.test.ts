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
// No mail leaves the tests; the messages are recorded so they can be inspected.
const mailSpy = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string; html: string }[], ok: true }));
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string; subject: string; text: string; html: string }) => {
    mailSpy.sent.push(m);
    return { ok: mailSpy.ok };
  },
}));
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
  resendInvite,
  resetPassword,
} from "./actions";
import { createStudentAccount } from "@/lib/staff-students";

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
async function makeUser(role: "staff" | "trainer" | "student") {
  counter += 1;
  const username = `${prefix}.${role}${counter}`;
  const email = role === "student" ? usernameToEmail(username) : `${username}@staff.test`;
  const password = testPassword();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: role === "staff" ? "admin" : role, username, full_name: `T8 ${role} ${counter}` },
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
      .insert({ curriculum_id: tempCurriculum, name: "T8 set", question_count: 1, time_limit_min: 10, pass_mark_percent: 50 })
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
  vi.unstubAllEnvs();
  const created = await must(db.from("profiles").select("id").like("username", `${prefix}%`));
  for (const { id } of created) await db.auth.admin.deleteUser(id);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  for (const id of curriculumIds) await db.from("curriculums").delete().eq("id", id);
});

beforeEach(() => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  mailSpy.sent.length = 0;
  mailSpy.ok = true;
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
    const result = await createStudent({ contactEmail: "t@example.test", username: username.toUpperCase(), fullName: "Nina Nurse", batch: "B7", track: "nursing", password });
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
    expect(await createStudent({ contactEmail: "t@example.test", username, fullName: "Otto Other", batch: " ", track: "other", password })).toMatchObject({ ok: true });
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
    expect(await createStudent({ contactEmail: "t@example.test", username, fullName: "First", batch: "", track: "other", password: first })).toMatchObject({ ok: true });
    const second = testPassword();
    const result = await createStudent({ contactEmail: "t@example.test", username, fullName: "Second", batch: "", track: "nursing", password: second });
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
    const result = await createStudent({ contactEmail: "t@example.test", username: staffProfile!.username, fullName: "Clash", batch: "", track: "other", password: testPassword() });
    expect(result).toEqual({ ok: false, message: `Username "${staffProfile!.username}" is already taken` });
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.some((u) => u.email === usernameToEmail(staffProfile!.username))).toBe(false);
  });

  it("rejects invalid input and creates nothing", async () => {
    asStaff();
    const username = `${prefix}.short`;
    expect(await createStudent({ contactEmail: "t@example.test", username, fullName: "Short", batch: "", track: "other", password: "short" })).toEqual({
      ok: false,
      message: "Password must be at least 8 characters",
    });
    expect(await createStudent({ contactEmail: "t@example.test", username, fullName: "Bad", batch: "", track: "medicine", password: testPassword() })).toMatchObject({ ok: false });
    expect(await createStudent({ contactEmail: "t@example.test", username: "bad name", fullName: "Bad", batch: "", track: "other", password: testPassword() })).toMatchObject({ ok: false });
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
      expect(await createStudent({ contactEmail: "t@example.test", username, fullName: "Renamed", batch: "", track: "other", password: testPassword() })).toMatchObject({ ok: true });
      expect(await assignmentsOf((await profileId(username))!)).toEqual([[renamed, 1]]);
    } finally {
      await db.from("curriculums").update({ name: LIFE }).eq("name", renamed);
    }
  });

  it("refuses a password with leading or trailing spaces", async () => {
    asStaff();
    const username = `${prefix}.spaces`;
    expect(await createStudent({ contactEmail: "t@example.test", username, fullName: "Spaces", batch: "", track: "other", password: ` ${testPassword()}` })).toEqual({
      ok: false,
      message: "Password must not start or end with a space",
    });
    expect(await profileId(username)).toBeNull();
  });
});

function asTrainer(client: SupabaseClient) {
  session.client = client;
}

/** The staff session with the student_details insert failing (everything else is real). */
function withFailingDetailsInsert(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) =>
          table === "student_details"
            ? { insert: async () => ({ data: null, error: { code: "XX000", message: "injected" } }) }
            : target.from(table);
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function trainerIdOf(username: string): Promise<string | null> {
  const { data } = await db.from("profiles").select("trainer_id").eq("username", username).maybeSingle();
  return data?.trainer_id ?? null;
}

describe("createStudent: owner and details", () => {
  const base = (username: string) => ({ username, fullName: "Owned Student", batch: "B1", track: "other", password: testPassword(), contactEmail: "owned@example.test" });

  it("a trainer-created student belongs to that trainer, gets assignments, and the result has no password", async () => {
    const trainer = await makeUser("trainer");
    asTrainer(trainer.client);
    const username = `${prefix}.own1`;
    const input = base(username);
    const result = await createStudent(input);
    expect(result).toEqual({ ok: true, studentId: expect.any(String), invite: "sent" });
    expect(JSON.stringify(result)).not.toContain(input.password);
    expect(await trainerIdOf(username)).toBe(trainer.id);
    expect(await assignmentsOf((result as { studentId: string }).studentId)).toEqual([[LIFE, 1]]);
  });

  it("a trainer cannot choose another owner: a passed trainer id is ignored", async () => {
    const trainer = await makeUser("trainer");
    const other = await makeUser("trainer");
    asTrainer(trainer.client);
    const username = `${prefix}.own2`;
    expect(await createStudent({ ...base(username), trainerId: other.id })).toMatchObject({ ok: true });
    expect(await trainerIdOf(username)).toBe(trainer.id);
    // Not even null: a trainer is always the owner.
    const username2 = `${prefix}.own2b`;
    expect(await createStudent({ ...base(username2), trainerId: null })).toMatchObject({ ok: true });
    expect(await trainerIdOf(username2)).toBe(trainer.id);
  });

  it("an admin chooses a trainer, or none", async () => {
    const trainer = await makeUser("trainer");
    asStaff();
    const chosen = `${prefix}.own3`;
    const first = await createStudent({ ...base(chosen), trainerId: trainer.id });
    expect(first).toMatchObject({ ok: true });
    expect(await trainerIdOf(chosen)).toBe(trainer.id);
    expect(await assignmentsOf((first as { studentId: string }).studentId)).toEqual([[LIFE, 1]]);

    const unowned = `${prefix}.own3b`;
    const second = await createStudent({ ...base(unowned), trainerId: null });
    expect(second).toMatchObject({ ok: true });
    expect(await trainerIdOf(unowned)).toBeNull();
    expect(await assignmentsOf((second as { studentId: string }).studentId)).toEqual([[LIFE, 1]]);
    const third = `${prefix}.own3c`;
    expect(await createStudent(base(third))).toMatchObject({ ok: true });
    expect(await trainerIdOf(third)).toBeNull();
  });

  it("an admin-supplied trainer id must be an active trainer, otherwise nothing is created", async () => {
    asStaff();
    const gone = await makeUser("trainer");
    await db.from("profiles").update({ active: false }).eq("id", gone.id);
    const adminUser = await makeUser("staff");
    const bad: { label: string; trainerId: string }[] = [
      { label: "deactivated trainer", trainerId: gone.id },
      { label: "an admin", trainerId: adminUser.id },
      { label: "a student", trainerId: studentId },
      { label: "unknown uuid", trainerId: randomUUID() },
      { label: "not a uuid", trainerId: "nope" },
    ];
    for (const [i, { trainerId }] of bad.entries()) {
      const username = `${prefix}.own4${i}`;
      const input = base(username);
      const result = await createStudent({ ...input, trainerId });
      expect(result).toEqual({ ok: false, message: "Choose an active trainer for this student" });
      expect(JSON.stringify(result)).not.toContain(input.password);
      expect(await profileId(username)).toBeNull();
    }
  });

  it("saves the details row with the owning trainer's session, and a minimal row with just the contact email", async () => {
    const trainer = await makeUser("trainer");
    asTrainer(trainer.client);
    const username = `${prefix}.det1`;
    const result = await createStudent({
      ...base(username),
      contactEmail: "Det.One@Example.test",
      details: { phone: "+91 98765 43210", passportNumber: "P1234567", germanLevel: "b1", programmeStart: "2027-01-10" },
    });
    expect(result).toMatchObject({ ok: true });
    const id = (result as { studentId: string }).studentId;
    const row = await must(db.from("student_details").select("*").eq("student_id", id).single());
    expect(row).toMatchObject({
      contact_email: "det.one@example.test",
      phone: "+91 98765 43210",
      passport_number: "P1234567",
      german_level: "B1",
      programme_start: "2027-01-10",
      status: "active",
    });
    // The trainer reads it back through RLS.
    const { data: own } = await trainer.client.from("student_details").select("contact_email").eq("student_id", id);
    expect(own).toEqual([{ contact_email: "det.one@example.test" }]);

    const plain = `${prefix}.det2`;
    const second = await createStudent(base(plain));
    expect(second).toMatchObject({ ok: true });
    // The contact email is required now, so even a student without other details has a row.
    expect(await must(db.from("student_details").select("contact_email").eq("student_id", (second as { studentId: string }).studentId))).toEqual([
      { contact_email: "owned@example.test" },
    ]);
  });

  it("refuses details without a contact email or with bad values, creating nothing", async () => {
    asStaff();
    const noEmail = `${prefix}.det3`;
    expect(await createStudent({ ...base(noEmail), contactEmail: "", details: { phone: "+91 98765 43210" } })).toMatchObject({ ok: false });
    expect(await profileId(noEmail)).toBeNull();
    const badPhone = `${prefix}.det4`;
    expect(await createStudent({ ...base(badPhone), contactEmail: "a@example.test", details: { phone: "call me" } })).toMatchObject({ ok: false });
    expect(await profileId(badPhone)).toBeNull();
    // Non-string detail values from a hand-made call are ignored, never thrown on.
    const odd = `${prefix}.det5`;
    expect(await createStudent({ ...base(odd), contactEmail: "a@example.test", details: { phone: 5 as never } })).toMatchObject({ ok: true });
  });

  it("removes the new user again when the details cannot be saved, with the generic message", async () => {
    const username = `${prefix}.det6`;
    const input = { ...base(username), contactEmail: "a@example.test", details: { phone: "+91 98765 43210" } };
    session.client = withFailingDetailsInsert(staffClient);
    const result = await createStudent(input);
    expect(result).toEqual({ ok: false, message: "The student could not be created. Please try again." });
    expect(JSON.stringify(result)).not.toContain(input.password);
    expect(await profileId(username)).toBeNull();
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.some((u) => u.email === usernameToEmail(username))).toBe(false);
    expect(await signIn(usernameToEmail(username), input.password)).toBeNull();
  });

  it("tells staff when the cleanup after a failed details save also failed", async () => {
    const username = `${prefix}.det7`;
    const input = { ...base(username), contactEmail: "a@example.test", details: { notes: "n" } };
    session.client = withFailingDetailsInsert(staffClient);
    adminSpy.failDelete = true;
    const result = await createStudent(input);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("cleanup failed") });
    expect(JSON.stringify(result)).not.toContain(input.password);
    adminSpy.failDelete = false;
    const id = await profileId(username);
    if (id) await db.auth.admin.deleteUser(id);
  });

  it("deleting a student also removes the details row (admin only)", async () => {
    const trainer = await makeUser("trainer");
    asTrainer(trainer.client);
    const username = `${prefix}.det8`;
    const created = await createStudent({ ...base(username), contactEmail: "a@example.test", details: { passportNumber: "P7654321" } });
    const id = (created as { studentId: string }).studentId;
    expect(await must(db.from("student_details").select("student_id").eq("student_id", id))).toHaveLength(1);
    // A trainer is sent away and nothing is deleted.
    await expect(deleteStudent(id, { confirmUsername: username })).rejects.toThrow(/REDIRECT/);
    expect(await profileId(username)).toBe(id);
    asStaff();
    expect(await deleteStudent(id, { confirmUsername: username })).toEqual({ ok: true });
    expect(await must(db.from("student_details").select("student_id").eq("student_id", id))).toEqual([]);
  });
});

describe("importStudents: owner and details", () => {
  it("a trainer's import makes them the owner of every row and saves the details", async () => {
    const trainer = await makeUser("trainer");
    const other = await makeUser("trainer");
    asTrainer(trainer.client);
    const pw1 = testPassword();
    const pw2 = testPassword();
    const csv = [
      "username,full_name,batch,track,password,contact_email,phone,german_level",
      `${prefix}.ti1,Imp One,B1,nursing,${pw1},ti1@example.test,+91 98765 43210,A2`,
      `${prefix}.ti2,Imp Two,B1,other,${pw2},,,`,
    ].join("\n");
    // A passed trainer id is ignored for a trainer.
    const result = await importStudents(csv, { trainerId: other.id });
    expect(result).toEqual({
      ok: true,
      created: [
        { row: 1, username: `${prefix}.ti1` },
        { row: 2, username: `${prefix}.ti2` },
      ],
      failed: [],
      invites: { invited: 1, noEmail: 1, failed: 0, failedUsernames: [] },
    });
    // Only the row with a contact email got a mail; its text has the username, no password.
    expect(mailSpy.sent.map((m) => m.to)).toEqual(["ti1@example.test"]);
    expect(mailSpy.sent[0].text).toContain(`${prefix}.ti1`);
    expect(mailSpy.sent[0].text).not.toContain(pw1);
    expect(JSON.stringify(result)).not.toContain(pw1);
    expect(await trainerIdOf(`${prefix}.ti1`)).toBe(trainer.id);
    expect(await trainerIdOf(`${prefix}.ti2`)).toBe(trainer.id);
    const id1 = (await profileId(`${prefix}.ti1`))!;
    const id2 = (await profileId(`${prefix}.ti2`))!;
    expect(await assignmentsOf(id1)).toEqual([
      [PFLEGE, 1],
      [LIFE, 2],
    ]);
    expect(await must(db.from("student_details").select("contact_email, phone, german_level").eq("student_id", id1))).toEqual([
      { contact_email: "ti1@example.test", phone: "+91 98765 43210", german_level: "A2" },
    ]);
    expect(await must(db.from("student_details").select("student_id").eq("student_id", id2))).toEqual([]);
  });

  it("an admin's import uses the chosen active trainer; an invalid one creates nothing", async () => {
    const trainer = await makeUser("trainer");
    asStaff();
    const pw = testPassword();
    const csv = `username,full_name,batch,track,password\n${prefix}.ai1,Adm One,B1,other,${pw}`;
    const refused = await importStudents(csv, { trainerId: randomUUID() });
    expect(refused).toEqual({ ok: false, message: "Choose an active trainer for these students", errors: [] });
    expect(await profileId(`${prefix}.ai1`)).toBeNull();
    expect(await importStudents(csv, { trainerId: trainer.id })).toMatchObject({ ok: true, created: [{ row: 1, username: `${prefix}.ai1` }] });
    expect(await trainerIdOf(`${prefix}.ai1`)).toBe(trainer.id);
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
      rows: [{ row: 1, username: `${prefix}.imp1`, fullName: "Imp One", batch: "B1", track: "nursing", willInvite: false }],
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
      invites: { invited: 0, noEmail: 2, failed: 0, failedUsernames: [] },
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

describe("importStudents: invites", () => {
  const header = "username,full_name,batch,track,password,contact_email";

  it("the preview marks which rows will get an invite", async () => {
    asStaff();
    const csv = [header, `${prefix}.pv1,Pv One,B1,other,${testPassword()},pv1@example.test`, `${prefix}.pv2,Pv Two,B1,other,${testPassword()},`].join("\n");
    const preview = await previewStudentsImport(csv);
    expect(preview).toMatchObject({ ok: true, rows: [{ username: `${prefix}.pv1`, willInvite: true }, { username: `${prefix}.pv2`, willInvite: false }] });
  });

  it("counts invited, no-email and failed invites; a failed mail does not undo the student", async () => {
    asStaff();
    mailSpy.ok = false;
    const csv = [header, `${prefix}.iv1,Iv One,B1,other,${testPassword()},iv1@example.test`, `${prefix}.iv2,Iv Two,B1,other,${testPassword()},`].join("\n");
    const result = await importStudents(csv);
    expect(result).toMatchObject({
      ok: true,
      created: [{ username: `${prefix}.iv1` }, { username: `${prefix}.iv2` }],
      invites: { invited: 0, noEmail: 1, failed: 1, failedUsernames: [`${prefix}.iv1`] },
    });
    expect(await profileId(`${prefix}.iv1`)).not.toBeNull();
  });
});

describe("student import row cap", () => {
  const big = (n: number) =>
    ["username,full_name,batch,track,password", ...Array.from({ length: n }, (_, i) => `${prefix}.cap${i},Cap ${i},B1,other,${testPassword()}`)].join("\n");
  const capCount = async () => (await must(db.from("profiles").select("id").like("username", `${prefix}.cap%`))).length;
  const MESSAGE = "This file has 201 students; import at most 200 at a time, split the file.";

  it("preview and import refuse 201 rows with the same message and create nothing", async () => {
    asStaff();
    const csv = big(201);
    expect(await previewStudentsImport(csv)).toEqual({ ok: true, rows: [], errors: [{ row: 0, message: MESSAGE }] });
    expect(await importStudents(csv)).toEqual({ ok: false, message: "Nothing was created. Fix the rows below and import again.", errors: [{ row: 0, message: MESSAGE }] });
    expect(await capCount()).toBe(0);
    expect(mailSpy.sent).toEqual([]);
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
    // One atomic write through the service-role function, as the session's staff member (0016).
    expect(adminSpy.rpcCalls).toEqual([
      { fn: "reorder_curriculums", args: { p_staff_id: staffId, p_student_id: s.id, p_curriculum_ids: [tempCurriculum2, tempCurriculum] } },
    ]);
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
    const { attemptId } = await startAttempt(s.id, tempCurriculum);
    await db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: false });

    expect(await removeCurriculum(s.id, tempCurriculum)).toEqual({
      ok: false,
      code: "has_attempts",
      message: "This student has 1 attempt in this curriculum. Confirm to remove the assignment; the attempts are kept.",
    });
    expect(await assignmentsOf(s.id)).toHaveLength(1);

    adminSpy.rpcCalls.length = 0;
    expect(await removeCurriculum(s.id, tempCurriculum, { confirm: true })).toEqual({ ok: true });
    // One atomic check-and-delete through the service-role function (0016).
    expect(adminSpy.rpcCalls.filter((c) => c.fn === "remove_curriculum")).toEqual([
      { fn: "remove_curriculum", args: { p_staff_id: staffId, p_student_id: s.id, p_curriculum_id: tempCurriculum, p_confirm: true } },
    ]);
    expect(await assignmentsOf(s.id)).toEqual([]);
    const attempts = await must(db.from("attempts").select("id").eq("student_id", s.id));
    expect(attempts).toHaveLength(1);
  });

  it("refuses while an attempt is in progress, even with confirm; without attempts removes at once with its extra attempts", async () => {
    asStaff();
    const s = await makeUser("student");
    await assignCurriculum(s.id, tempCurriculum);
    await startAttempt(s.id, tempCurriculum);
    expect(await removeCurriculum(s.id, tempCurriculum, { confirm: true })).toMatchObject({ ok: false, code: "in_progress" });

    const t = await makeUser("student");
    await assignCurriculum(t.id, tempCurriculum);
    await db.from("assignments").update({ extra_attempts: 2 }).eq("student_id", t.id).eq("curriculum_id", tempCurriculum);
    expect(await removeCurriculum(t.id, tempCurriculum)).toEqual({ ok: true });
    expect(await assignmentsOf(t.id)).toEqual([]);
    // The extra attempts lived on the assignment row: assigning again starts from the default.
    await assignCurriculum(t.id, tempCurriculum);
    const again = await must(db.from("assignments").select("extra_attempts").eq("student_id", t.id).single());
    expect(again).toEqual({ extra_attempts: 0 });
  });
});

describe("deleteStudent (DPDP delete path)", () => {
  it("needs the username typed exactly, then removes the account, profile, assignments and attempts", async () => {
    asStaff();
    const s = await makeUser("student");
    await assignCurriculum(s.id, tempCurriculum);
    const { attemptId } = await startAttempt(s.id, tempCurriculum);
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
    await startAttempt(s.id, tempCurriculum);
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
    await expect(createStudent({ contactEmail: "t@example.test", username, fullName: "X", batch: "", track: "other", password: pw })).rejects.toThrow(/REDIRECT/);
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

/** A staff session where inserting into `table` throws (not returns an error). */
function withThrowingInsert(client: SupabaseClient, table: string): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "from") {
        return (name: string) =>
          name === table
            ? {
                insert: async () => {
                  throw new Error("injected throw");
                },
              }
            : target.from(name);
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("createStudent: duplicate username across trainers", () => {
  it("a username that belongs to another trainer's student gets the friendly message and leaves no auth user", async () => {
    const owner = await makeUser("trainer");
    const intruder = await makeUser("trainer");
    asTrainer(owner.client);
    const username = `${prefix}.x1`;
    expect(await createStudent({ contactEmail: "t@example.test", username, fullName: "Mine", batch: "", track: "other", password: testPassword() })).toMatchObject({ ok: true });
    // The second trainer cannot see that profile through RLS, so the duplicate is caught by Auth.
    asTrainer(intruder.client);
    const second = testPassword();
    const result = await createStudent({ contactEmail: "t@example.test", username, fullName: "Yours", batch: "", track: "other", password: second });
    expect(result).toEqual({ ok: false, message: `Username "${username}" is already taken` });
    const rows = await must(db.from("profiles").select("id, full_name, trainer_id").eq("username", username));
    expect(rows).toEqual([{ id: expect.any(String), full_name: "Mine", trainer_id: owner.id }]);
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.filter((u) => u.email === usernameToEmail(username))).toHaveLength(1);
    expect(await signIn(usernameToEmail(username), second)).toBeNull();
  });
});

describe("createStudentAccount: a throw after the user exists also rolls back", () => {
  it.each(["student_details", "assignments"])("removes the new user when the %s insert throws", async (table) => {
    const username = `${prefix}.thr.${table.slice(0, 3)}`;
    const checked = {
      username,
      fullName: "Thrown",
      batch: "",
      track: "other" as const,
      password: testPassword(),
      contactEmail: "a@example.test",
      details: {
        contactEmail: "a@example.test",
        phone: null, guardianName: null, guardianPhone: null, dateOfBirth: null, gender: null, address: null,
        passportNumber: null, passportExpiry: null, destinationCountry: null, targetIntake: null, germanLevel: null,
        qualification: null, joinedOn: null, programmeStart: null, status: "active" as const, notes: null,
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createStudentAccount(withThrowingInsert(staffClient, table), checked, { trainerId: null });
    spy.mockRestore();
    expect(result).toEqual({ ok: false, message: "The student could not be created. Please try again." });
    expect(await profileId(username)).toBeNull();
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.some((u) => u.email === usernameToEmail(username))).toBe(false);
  });
});

describe("invites from createStudent and resendInvite", () => {
  const base = (username: string) => ({ username, fullName: "Invited Student", batch: "", track: "other", password: testPassword(), contactEmail: "invited@example.test" });

  it("createStudent sends the invite to the contact email and says only 'sent'", async () => {
    asStaff();
    const username = `${prefix}.inv1`;
    const input = { ...base(username), contactEmail: "Invitee@Example.test" };
    const result = await createStudent(input);
    expect(result).toEqual({ ok: true, studentId: expect.any(String), invite: "sent" });
    expect(mailSpy.sent).toHaveLength(1);
    expect(mailSpy.sent[0].to).toBe("invitee@example.test");
    expect(mailSpy.sent[0].text).toContain("http://localhost:3000/set-password?token_hash=");
    expect(mailSpy.sent[0].text).toContain(username);
    expect(mailSpy.sent[0].text).not.toContain(input.password);
    expect(JSON.stringify(result)).not.toContain("token_hash");
  });

  it("createStudent without a contact email is refused: no account, no mail", async () => {
    asStaff();
    const username = `${prefix}.inv2`;
    for (const contactEmail of [undefined, "", "   "]) {
      expect(await createStudent({ ...base(username), contactEmail: contactEmail as never })).toEqual({ ok: false, message: "Missing contact email" });
    }
    expect(await profileId(username)).toBeNull();
    expect(mailSpy.sent).toHaveLength(0);
  });

  it("a failing mail or a bad APP_URL gives invite 'failed' and the student still exists", async () => {
    asStaff();
    const a = `${prefix}.inv3`;
    mailSpy.ok = false;
    expect(await createStudent({ ...base(a), contactEmail: "a@example.test" })).toMatchObject({ ok: true, invite: "failed" });
    expect(await profileId(a)).not.toBeNull();
    mailSpy.ok = true;
    vi.stubEnv("APP_URL", "not-a-url");
    const b = `${prefix}.inv4`;
    expect(await createStudent({ ...base(b), contactEmail: "b@example.test" })).toMatchObject({ ok: true, invite: "failed" });
    expect(await profileId(b)).not.toBeNull();
  });

  it("resendInvite sends a fresh link for a student of the caller, and refuses others", async () => {
    const trainer = await makeUser("trainer");
    const other = await makeUser("trainer");
    asTrainer(trainer.client);
    const username = `${prefix}.inv5`;
    const created = await createStudent({ ...base(username), contactEmail: "r@example.test" });
    const id = (created as { studentId: string }).studentId;
    mailSpy.sent.length = 0;
    expect(await resendInvite(id)).toEqual({ ok: true });
    expect(mailSpy.sent).toHaveLength(1);
    expect(mailSpy.sent[0].to).toBe("r@example.test");

    asTrainer(other.client);
    mailSpy.sent.length = 0;
    expect(await resendInvite(id)).toEqual({ ok: false, message: "Student not found" });
    expect(await resendInvite("nope")).toEqual({ ok: false, message: "Student not found" });
    expect(mailSpy.sent).toHaveLength(0);

    asStaff();
    expect(await resendInvite(id)).toEqual({ ok: true });
  });

  it("resendInvite tells staff when there is no contact email or the mail failed", async () => {
    asStaff();
    // An account without a contact email (e.g. from the CSV import or an older student).
    const plain = await makeUser("student");
    expect(await resendInvite(plain.id)).toEqual({
      ok: false,
      message: "This student has no contact email, so no invite can be sent.",
    });
    const withMail = await createStudent({ ...base(`${prefix}.inv7`), contactEmail: "m@example.test" });
    mailSpy.ok = false;
    expect(await resendInvite((withMail as { studentId: string }).studentId)).toEqual({
      ok: false,
      message: "The invite could not be sent. Please try again.",
    });
  });

  it("a student session cannot resend invites", async () => {
    asStudent();
    await expect(resendInvite(studentId)).rejects.toThrow(/REDIRECT/);
    expect(mailSpy.sent).toHaveLength(0);
  });
});
