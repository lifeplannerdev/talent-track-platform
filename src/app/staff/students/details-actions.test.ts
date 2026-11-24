// Integration tests for saveStudentDetails and assignTrainer against the LOCAL Supabase stack.
// Sessions are real (password sign-in with the anon key); only the Next.js request plumbing is
// replaced. All passwords are TEST values generated per run.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { usernameToEmail } from "@/lib/auth/username";
import { assignTrainer, saveStudentDetails } from "./details-actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const prefix = `t8d.${run}`;
const userIds: string[] = [];
let counter = 0;

type User = { id: string; client: SupabaseClient };

async function makeUser(role: "admin" | "trainer" | "student", extra: Record<string, string> = {}): Promise<User> {
  counter += 1;
  const username = `${prefix}.${role}${counter}`;
  const email = role === "student" ? usernameToEmail(username) : `${username}@staff.test`;
  const password = `test-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: `T8d ${role} ${counter}`, ...extra },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

async function detailsRow(studentId: string) {
  const { data } = await db.from("student_details").select("*").eq("student_id", studentId).maybeSingle();
  return data;
}

afterAll(async () => {
  for (const id of userIds.reverse()) await db.auth.admin.deleteUser(id);
});

beforeEach(() => {
  session.client = null;
});

const GOOD = { contactEmail: "Kid@Example.test", phone: "+91 98765 43210", passportNumber: "P1234567", germanLevel: "b1", notes: "Internal" };

describe("saveStudentDetails", () => {
  it("a trainer saves details of their own student (first save creates the row, later saves update it)", async () => {
    const trainer = await makeUser("trainer");
    const student = await makeUser("student", { trainer_id: trainer.id });
    session.client = trainer.client;
    expect(await saveStudentDetails({ studentId: student.id, details: GOOD })).toEqual({ ok: true });
    expect(await detailsRow(student.id)).toMatchObject({ contact_email: "kid@example.test", german_level: "B1", passport_number: "P1234567" });
    expect(await saveStudentDetails({ studentId: student.id, details: { ...GOOD, phone: "" } })).toEqual({ ok: true });
    expect(await detailsRow(student.id)).toMatchObject({ phone: null });
  });

  it("keeps an expired stored passport expiry when other fields change, but refuses a new or changed past date", async () => {
    const admin = await makeUser("admin");
    const student = await makeUser("student");
    session.client = admin.client;
    // An expiry that has since passed, stored directly (the form would have refused it today).
    await db.from("student_details").insert({ student_id: student.id, contact_email: "kid@example.test", passport_expiry: "2020-01-01", status: "active" });
    const unchanged = { contactEmail: "kid@example.test", passportExpiry: "2020-01-01", status: "on_hold", notes: "Waiting for renewal" };
    expect(await saveStudentDetails({ studentId: student.id, details: unchanged })).toEqual({ ok: true });
    expect(await detailsRow(student.id)).toMatchObject({ passport_expiry: "2020-01-01", status: "on_hold", notes: "Waiting for renewal" });
    expect(await saveStudentDetails({ studentId: student.id, details: { ...unchanged, passportExpiry: "2021-01-01" } })).toMatchObject({ ok: false });
    expect(await detailsRow(student.id)).toMatchObject({ passport_expiry: "2020-01-01" });
    // A student with no stored details: a past date is refused and nothing is created.
    const fresh = await makeUser("student");
    expect(await saveStudentDetails({ studentId: fresh.id, details: unchanged })).toMatchObject({ ok: false });
    expect(await detailsRow(fresh.id)).toBeNull();
  });

  it("a trainer cannot save details of another trainer's student: refused and nothing is written", async () => {
    const trainer = await makeUser("trainer");
    const other = await makeUser("trainer");
    const theirs = await makeUser("student", { trainer_id: other.id });
    session.client = trainer.client;
    expect(await saveStudentDetails({ studentId: theirs.id, details: GOOD })).toEqual({ ok: false, message: "Student not found" });
    expect(await detailsRow(theirs.id)).toBeNull();
    // Even when the other trainer's student already has details, they stay unchanged.
    session.client = other.client;
    expect(await saveStudentDetails({ studentId: theirs.id, details: GOOD })).toEqual({ ok: true });
    session.client = trainer.client;
    expect(await saveStudentDetails({ studentId: theirs.id, details: { contactEmail: "evil@example.test" } })).toEqual({
      ok: false,
      message: "Student not found",
    });
    expect(await detailsRow(theirs.id)).toMatchObject({ contact_email: "kid@example.test" });
  });

  it("an admin saves details of any student; an unassigned student is not visible to a trainer", async () => {
    const admin = await makeUser("admin");
    const trainer = await makeUser("trainer");
    const loose = await makeUser("student");
    session.client = trainer.client;
    expect(await saveStudentDetails({ studentId: loose.id, details: GOOD })).toMatchObject({ ok: false });
    session.client = admin.client;
    expect(await saveStudentDetails({ studentId: loose.id, details: GOOD })).toEqual({ ok: true });
  });

  it("validates (contact email required, bad phone, bad id, non-student) and never throws on junk", async () => {
    const admin = await makeUser("admin");
    const student = await makeUser("student");
    session.client = admin.client;
    expect(await saveStudentDetails({ studentId: student.id, details: { phone: "+91 98765 43210" } })).toEqual({ ok: false, message: "Missing contact email" });
    expect(await saveStudentDetails({ studentId: student.id, details: { contactEmail: "a@example.test", phone: "call me" } })).toMatchObject({ ok: false });
    expect(await saveStudentDetails({ studentId: "nope", details: GOOD })).toEqual({ ok: false, message: "Student not found" });
    expect(await saveStudentDetails({ studentId: admin.id, details: GOOD })).toEqual({ ok: false, message: "Student not found" });
    expect(await saveStudentDetails({ studentId: student.id, details: { contactEmail: "a@example.test", phone: 5 as never } })).toEqual({ ok: true });
    expect(await saveStudentDetails(null as never)).toEqual({ ok: false, message: "Student not found" });
  });

  it("a student is redirected and nothing is written", async () => {
    const student = await makeUser("student");
    session.client = student.client;
    await expect(saveStudentDetails({ studentId: student.id, details: GOOD })).rejects.toThrow(/REDIRECT/);
    expect(await detailsRow(student.id)).toBeNull();
  });
});

describe("assignTrainer", () => {
  it("an admin assigns an active trainer, moves the student, and can clear the trainer", async () => {
    const admin = await makeUser("admin");
    const t1 = await makeUser("trainer");
    const t2 = await makeUser("trainer");
    const student = await makeUser("student", { trainer_id: t1.id });
    session.client = admin.client;
    expect(await assignTrainer({ studentId: student.id, trainerId: t2.id })).toMatchObject({ ok: true });
    const owner = async () => (await db.from("profiles").select("trainer_id").eq("id", student.id).single()).data?.trainer_id;
    expect(await owner()).toBe(t2.id);
    expect(await assignTrainer({ studentId: student.id, trainerId: "" })).toMatchObject({ ok: true });
    expect(await owner()).toBeNull();
  });

  it("refuses an unknown, non-trainer or inactive trainer and a non-student", async () => {
    const admin = await makeUser("admin");
    const gone = await makeUser("trainer");
    await db.from("profiles").update({ active: false }).eq("id", gone.id);
    const student = await makeUser("student");
    session.client = admin.client;
    const refused = { ok: false, message: "Choose an active trainer for this student" };
    expect(await assignTrainer({ studentId: student.id, trainerId: randomUUID() })).toEqual(refused);
    expect(await assignTrainer({ studentId: student.id, trainerId: admin.id })).toEqual(refused);
    expect(await assignTrainer({ studentId: student.id, trainerId: gone.id })).toEqual(refused);
    expect(await assignTrainer({ studentId: student.id, trainerId: "x" })).toEqual(refused);
    const t = await makeUser("trainer");
    expect(await assignTrainer({ studentId: t.id, trainerId: t.id })).toEqual({ ok: false, message: "Student not found" });
    const { data } = await db.from("profiles").select("trainer_id").eq("id", student.id).single();
    expect(data?.trainer_id).toBeNull();
  });

  it("a trainer calling it is redirected and nothing changes", async () => {
    const trainer = await makeUser("trainer");
    const student = await makeUser("student", { trainer_id: trainer.id });
    const other = await makeUser("trainer");
    session.client = trainer.client;
    await expect(assignTrainer({ studentId: student.id, trainerId: other.id })).rejects.toThrow("REDIRECT /staff");
    const { data } = await db.from("profiles").select("trainer_id").eq("id", student.id).single();
    expect(data?.trainer_id).toBe(trainer.id);
  });
});
