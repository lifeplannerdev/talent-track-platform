// Integration tests for getStudentDetail (staff student page) against the LOCAL Supabase stack with
// a real staff session. The page must agree with the Blocked and Extra attempts pages
// (staff-overview-core facts()): effective status and exam sets left use the same rules.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

import { getStudentDetail, listStudents } from "./staff-manage";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
const curriculumIds: string[] = [];
let staff: SupabaseClient;

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

async function makeUser(role: "staff" | "student", n: number) {
  const username = `smt.${run}.${role}${n}`;
  const email = `${username}@${role}.test`;
  const password = `test-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: `Smt ${role} ${n}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { id: data.user.id, client };
}

/** A curriculum (2 attempts per student) with exam sets of one approved question each; count > 1 cannot fill a paper. */
async function curriculum(setCounts: number[]) {
  const c = await must(db.from("curriculums").insert({ name: `Smt ${run} ${randomUUID().slice(0, 6)}` }).select("id").single());
  curriculumIds.push(c.id);
  const sets: string[] = [];
  for (const [i, count] of setCounts.entries()) {
    const s = await must(
      db
        .from("exam_sets")
        .insert({ curriculum_id: c.id, name: `Set ${i + 1}`, question_count: count, time_limit_min: 10 })
        .select("id")
        .single(),
    );
    await must(
      db
        .from("questions")
        .insert({
          exam_set_id: s.id,
          topic: "t",
          difficulty: "easy",
          stem_de: `Frage ${i}?`,
          stem_en: `Question ${i}?`,
          options: [
            { id: "a", de: "Ja", en: "Yes" },
            { id: "b", de: "Nein", en: "No" },
          ],
          correct_option_id: "b",
          points: 1,
          status: "approved",
        })
        .select("id"),
    );
    sets.push(s.id);
  }
  return { id: c.id as string, sets };
}

async function attempt(studentId: string, examSetId: string, status: "in_progress" | "released", at: string) {
  await must(
    db
      .from("attempts")
      .insert({
        student_id: studentId,
        exam_set_id: examSetId,
        status,
        started_at: at,
        deadline_at: new Date(Date.parse(at) + 10 * 60_000).toISOString(),
        ...(status === "released"
          ? { submitted_at: at, points: 0, max_points: 1, passed: false, released_at: at }
          : { deadline_at: new Date(Date.now() + 10 * 60_000).toISOString() }),
      })
      .select("id"),
  );
}

beforeAll(async () => {
  staff = (await makeUser("staff", 1)).client;
  session.client = staff;
});

afterAll(async () => {
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  if (curriculumIds.length) await db.from("curriculums").delete().in("id", curriculumIds);
});

describe("getStudentDetail", () => {
  it("shows an open assignment with every attempt used and nothing running as blocked (like the Blocked page)", async () => {
    const student = await makeUser("student", 2);
    const c = await curriculum([1, 1]);
    // Stored status stays 'open' (legacy data, or staff edited it); both attempts failed.
    await must(db.from("assignments").insert({ student_id: student.id, curriculum_id: c.id, position: 1, status: "open" }).select("id"));
    await attempt(student.id, c.sets[0], "released", "2026-01-01T10:00:00Z");
    await attempt(student.id, c.sets[1], "released", "2026-01-02T10:00:00Z");

    const s = await getStudentDetail(student.id);
    const a = s!.assignments[0];
    expect(a.status).toBe("open");
    expect(a.effectiveStatus).toBe("blocked");
  });

  it("keeps the status while an attempt is in progress (the outcome is not known yet)", async () => {
    const student = await makeUser("student", 3);
    const c = await curriculum([1, 1]);
    await must(
      db.from("assignments").insert({ student_id: student.id, curriculum_id: c.id, position: 1, status: "open", extra_attempts: 0 }).select("id"),
    );
    await attempt(student.id, c.sets[0], "released", "2026-01-01T10:00:00Z");
    await attempt(student.id, c.sets[1], "in_progress", new Date().toISOString());

    const a = (await getStudentDetail(student.id))!.assignments[0];
    expect(a.effectiveStatus).toBe("open");
  });

  it("counts only unused exam sets whose approved questions can fill a paper as exam sets left", async () => {
    const student = await makeUser("student", 4);
    // Set 1 used; set 2 fillable and unused; set 3 needs 5 questions but has 1.
    const c = await curriculum([1, 1, 5]);
    await must(db.from("assignments").insert({ student_id: student.id, curriculum_id: c.id, position: 1, status: "open" }).select("id"));
    await attempt(student.id, c.sets[0], "released", "2026-01-01T10:00:00Z");

    const a = (await getStudentDetail(student.id))!.assignments[0];
    expect(a.examSetsLeft).toBe(1);
    expect(a.effectiveStatus).toBe("open");
  });
});

describe("listStudents", () => {
  const row = async (username: string) => (await listStudents({ q: username })).rows.find((r) => r.username === username)!;
  const usernameOf = async (id: string) => (await must(db.from("profiles").select("username").eq("id", id).single())).username as string;

  it("badges an open curriculum with every attempt used and nothing running as blocked (stored status kept)", async () => {
    const student = await makeUser("student", 5);
    const c = await curriculum([1, 1]);
    await must(db.from("assignments").insert({ student_id: student.id, curriculum_id: c.id, position: 1, status: "open" }).select("id"));
    await attempt(student.id, c.sets[0], "released", "2026-01-01T10:00:00Z");
    await attempt(student.id, c.sets[1], "released", "2026-01-02T10:00:00Z");

    const a = (await row(await usernameOf(student.id))).assignments[0];
    expect(a.status).toBe("open");
    expect(a.effectiveStatus).toBe("blocked");
  });

  it("shows blocked when staff lower the attempts per student below what the student already used", async () => {
    const student = await makeUser("student", 6);
    const c = await curriculum([1, 1]);
    await must(db.from("assignments").insert({ student_id: student.id, curriculum_id: c.id, position: 1, status: "open" }).select("id"));
    await attempt(student.id, c.sets[0], "released", "2026-01-01T10:00:00Z");
    const username = await usernameOf(student.id);
    expect((await row(username)).assignments[0].effectiveStatus).toBe("open");

    await must(db.from("curriculums").update({ max_attempts: 1 }).eq("id", c.id).select("id"));
    expect((await row(username)).assignments[0].effectiveStatus).toBe("blocked");
  });

  it("keeps open while an attempt is in progress, and counts extra attempts", async () => {
    const student = await makeUser("student", 7);
    const c = await curriculum([1, 1, 1]);
    const d = await curriculum([1, 1]);
    await must(
      db
        .from("assignments")
        .insert([
          { student_id: student.id, curriculum_id: c.id, position: 1, status: "open", extra_attempts: 0 },
          { student_id: student.id, curriculum_id: d.id, position: 2, status: "open", extra_attempts: 1 },
        ])
        .select("id"),
    );
    await attempt(student.id, c.sets[0], "released", "2026-01-01T10:00:00Z");
    await attempt(student.id, c.sets[1], "in_progress", new Date().toISOString());
    await attempt(student.id, d.sets[0], "released", "2026-01-01T10:00:00Z");
    await attempt(student.id, d.sets[1], "released", "2026-01-02T10:00:00Z");

    const [first, second] = (await row(await usernameOf(student.id))).assignments;
    expect(first.effectiveStatus).toBe("open");
    expect(second.effectiveStatus).toBe("open");
  });
});
