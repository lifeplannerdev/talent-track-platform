// Integration tests for blocking (release_attempt, migration 0008), staff grants and the staff
// overview readers. They run against the LOCAL Supabase stack with throwaway users and exam
// sets. Student and staff sessions are real (password sign-in with the anon key), so RLS and the
// student views are exercised exactly as in the app. Only the Next.js request plumbing is
// replaced: createClient() returns the signed-in client of the current test, redirect() throws.
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

import { AttemptError, saveAnswer, startAttempt, submitAttempt } from "./attempts";
import { GrantError, grantAttempt } from "./grants";
import { releaseAttempt } from "./release";
import { getDashboard, listBlockedStudents, listGrantable } from "./staff-overview";
import { grantAttemptAction } from "@/app/staff/grants/actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
const curriculumIds: string[] = [];
let staffId = "";
let staff2Id = "";
let staffClient: SupabaseClient;

type ExamSet = { curriculumId: string; setId: string; name: string };
// small: 5 approved questions (and 1 draft), 2 per paper, 2 attempts: after two papers 1 unseen is left.
// big: 6 approved questions: after two papers 2 unseen are left, enough for an override.
let small: ExamSet;
let big: ExamSet;
// multiA and multiB: two exam sets (4 approved questions each, 1 attempt each) of one curriculum.
let multiA: ExamSet;
let multiB: ExamSet;

const OPTIONS = [
  { id: "a", de: "Ja", en: "Yes" },
  { id: "b", de: "Nein", en: "No" },
];

async function ok(p: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await p;
  if (error) throw error;
}

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

async function makeExamSet(
  label: string,
  approved: number,
  opts: { curriculumId?: string; setName?: string; maxAttempts?: number } = {},
): Promise<ExamSet> {
  const name = `T7 ${label} ${run}`;
  let curriculumId = opts.curriculumId;
  if (!curriculumId) {
    const curriculum = await must(db.from("curriculums").insert({ name }).select("id").single());
    curriculumIds.push(curriculum.id);
    curriculumId = curriculum.id;
  }
  const set = await must(
    db
      .from("exam_sets")
      .insert({
        curriculum_id: curriculumId,
        name: opts.setName ?? `${name} set`,
        question_count: 2,
        time_limit_min: 20,
        pass_mark_percent: 60,
        max_attempts: opts.maxAttempts ?? 2,
        hold_result: true,
      })
      .select("id")
      .single(),
  );
  await ok(
    db.from("questions").insert(
      Array.from({ length: approved + 1 }, (_, i) => ({
        exam_set_id: set.id,
        topic: "t",
        difficulty: "easy",
        stem_de: `Frage ${i + 1} ${name}`,
        stem_en: `Question ${i + 1} ${name}`,
        options: OPTIONS,
        correct_option_id: "b",
        points: 1,
        status: i < approved ? "approved" : "draft",
      })),
    ),
  );
  return { curriculumId: curriculumId!, setId: set.id, name };
}

let counter = 0;
async function makeUser(
  role: "student" | "staff",
  batch?: string,
): Promise<{ id: string; name: string; client: SupabaseClient }> {
  counter += 1;
  const username = `t7.${run}.${role}.${counter}`;
  const email = `${username}@${role === "staff" ? "staff" : "students"}.test`;
  const password = randomUUID();
  const name = `T7 ${role} ${counter}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: name, ...(batch ? { batch } : {}) },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, name, client };
}

async function makeStudent(set: ExamSet, batch?: string) {
  const student = await makeUser("student", batch);
  await ok(db.from("assignments").insert({ student_id: student.id, curriculum_id: set.curriculumId, position: 1 }));
  return student;
}

/** Uses the student's grant: starts, answers every question with `pick` (key "b"), submits. */
async function takeAttempt(studentId: string, set: ExamSet, pick: "a" | "b" = "a"): Promise<string> {
  const { attemptId } = await startAttempt(studentId, set.setId);
  const paper = await must(db.from("attempt_questions").select("id").eq("attempt_id", attemptId));
  for (const q of paper) await saveAnswer(studentId, attemptId, q.id, pick);
  await submitAttempt(attemptId);
  return attemptId;
}

/** Grant, take and release one failed attempt. */
async function failAndRelease(studentId: string, set: ExamSet): Promise<string> {
  expect(await grantAttempt(studentId, set.setId, staffId)).toEqual({ ok: true });
  const attemptId = await takeAttempt(studentId, set);
  await releaseAttempt(attemptId, staffId);
  return attemptId;
}

async function assignmentStatus(studentId: string, set: ExamSet): Promise<string> {
  const row = await must(
    db.from("assignments").select("status").eq("student_id", studentId).eq("curriculum_id", set.curriculumId).single(),
  );
  return row.status;
}

async function studentSees(client: SupabaseClient, set: ExamSet): Promise<string> {
  const row = await must(client.from("student_assignments").select("status").eq("curriculum_id", set.curriculumId).single());
  return row.status;
}

async function grantCount(studentId: string): Promise<number> {
  const rows = await must(db.from("attempt_grants").select("id").eq("student_id", studentId));
  return rows.length;
}

async function seenQuestionIds(studentId: string): Promise<string[]> {
  const rows = (await must(
    db.from("attempt_questions").select("question_id, attempts!inner(student_id)").eq("attempts.student_id", studentId),
  )) as { question_id: string }[];
  return rows.map((r) => r.question_id);
}

beforeAll(async () => {
  small = await makeExamSet("small", 5);
  big = await makeExamSet("big", 6);
  multiA = await makeExamSet("multi", 4, { setName: `T7 multi ${run} set A`, maxAttempts: 1 });
  multiB = await makeExamSet("multi", 4, { curriculumId: multiA.curriculumId, setName: `T7 multi ${run} set B`, maxAttempts: 1 });
  ({ id: staffId, client: staffClient } = await makeUser("staff"));
  ({ id: staff2Id } = await makeUser("staff"));
});

afterAll(async () => {
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  for (const id of curriculumIds) await db.from("curriculums").delete().eq("id", id);
});

beforeEach(() => {
  session.client = null;
});

describe("blocking at release", () => {
  it("failing with an attempt left keeps the assignment open; failing the last allowed attempt blocks", async () => {
    const student = await makeStudent(small);
    await failAndRelease(student.id, small);
    expect(await assignmentStatus(student.id, small)).toBe("open");
    expect(await studentSees(student.client, small)).toBe("open");

    await failAndRelease(student.id, small);
    expect(await assignmentStatus(student.id, small)).toBe("blocked");
    expect(await studentSees(student.client, small)).toBe("blocked");
  });

  it("a pass marks the assignment passed", async () => {
    const student = await makeStudent(small);
    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: true });
    const attemptId = await takeAttempt(student.id, small, "b");
    await releaseAttempt(attemptId, staffId);
    expect(await assignmentStatus(student.id, small)).toBe("passed");
  });

  it("the block is not visible to the student while the last failed attempt is held", async () => {
    const student = await makeStudent(small);
    await failAndRelease(student.id, small);
    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: true });
    const held = await takeAttempt(student.id, small);

    expect(await assignmentStatus(student.id, small)).toBe("open"); // nothing written before release
    expect(await studentSees(student.client, small)).toBe("open");
    const direct = await student.client.from("assignments").select("status").eq("student_id", student.id);
    expect(direct.data ?? []).toEqual([]);

    await releaseAttempt(held, staffId);
    expect(await studentSees(student.client, small)).toBe("blocked");
  });

  it("release by two staff members stays idempotent with blocking", async () => {
    const student = await makeStudent(small);
    await failAndRelease(student.id, small);
    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: true });
    const attemptId = await takeAttempt(student.id, small);
    await Promise.all([releaseAttempt(attemptId, staffId), releaseAttempt(attemptId, staff2Id)]);
    const row = await must(db.from("attempts").select("status, released_by").eq("id", attemptId).single());
    expect(row.status).toBe("released");
    expect([staffId, staff2Id]).toContain(row.released_by);
    expect(await assignmentStatus(student.id, small)).toBe("blocked");
    await releaseAttempt(attemptId, staffId);
    expect(await must(db.from("attempts").select("released_by").eq("id", attemptId).single())).toEqual({
      released_by: row.released_by,
    });
  });
});

describe("grantAttempt", () => {
  it("gives a first attempt, recorded as granted by the staff member", async () => {
    const student = await makeStudent(small);
    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: true });
    const grants = await must(db.from("attempt_grants").select("granted_by, used_attempt_id").eq("student_id", student.id));
    expect(grants).toEqual([{ granted_by: staffId, used_attempt_id: null }]);
  });

  it("with too few unseen questions returns the shortfall and writes no grant", async () => {
    const student = await makeStudent(small);
    await failAndRelease(student.id, small);
    await failAndRelease(student.id, small);
    expect(await assignmentStatus(student.id, small)).toBe("blocked");
    const before = await grantCount(student.id);

    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: false, unseenAvailable: 1, needed: 2 });
    expect(await grantCount(student.id)).toBe(before);
    expect(await assignmentStatus(student.id, small)).toBe("blocked");
  });

  it("a grant after a block unblocks, and the new paper has only unseen questions", async () => {
    const student = await makeStudent(big);
    await failAndRelease(student.id, big);
    await failAndRelease(student.id, big);
    expect(await assignmentStatus(student.id, big)).toBe("blocked");
    const seen = await seenQuestionIds(student.id);
    expect(new Set(seen).size).toBe(4);

    expect(await grantAttempt(student.id, big.setId, staffId)).toEqual({ ok: true });
    expect(await assignmentStatus(student.id, big)).toBe("open");
    expect(await studentSees(student.client, big)).toBe("open");

    const { attemptId } = await startAttempt(student.id, big.setId);
    const paper = await must(db.from("attempt_questions").select("question_id").eq("attempt_id", attemptId));
    expect(paper).toHaveLength(2);
    for (const q of paper) expect(seen).not.toContain(q.question_id);
  });

  it("refuses to stack a grant on an unused one", async () => {
    const student = await makeStudent(small);
    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: true });
    await expect(grantAttempt(student.id, small.setId, staff2Id)).rejects.toMatchObject({ code: "grant_exists" });
    expect(await grantCount(student.id)).toBe(1);
  });

  it("refuses while an attempt is in progress", async () => {
    const student = await makeStudent(small);
    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: true });
    await startAttempt(student.id, small.setId);
    const refused = grantAttempt(student.id, small.setId, staffId);
    await expect(refused).rejects.toBeInstanceOf(GrantError);
    await expect(refused).rejects.toMatchObject({ code: "in_progress" });
    expect(await grantCount(student.id)).toBe(1);
  });

  it("refuses a granter who is not staff, and an exam set the student is not assigned to", async () => {
    const student = await makeStudent(small);
    await expect(grantAttempt(student.id, small.setId, student.id)).rejects.toMatchObject({ code: "not_staff" });
    await expect(grantAttempt(student.id, big.setId, staffId)).rejects.toMatchObject({ code: "not_assigned" });
    expect(await grantCount(student.id)).toBe(0);
  });

  it("refuses while a result in the curriculum is held (single exam set), writing nothing", async () => {
    const student = await makeStudent(small);
    expect(await grantAttempt(student.id, small.setId, staffId)).toEqual({ ok: true });
    await takeAttempt(student.id, small); // held, not released
    await expect(grantAttempt(student.id, small.setId, staffId)).rejects.toMatchObject({ code: "result_pending" });
    expect(await grantCount(student.id)).toBe(1);
  });

  it("refuses a grant on another exam set of the curriculum while one result is held (multi-set)", async () => {
    const student = await makeStudent(multiA);
    expect(await grantAttempt(student.id, multiA.setId, staffId)).toEqual({ ok: true });
    const held = await takeAttempt(student.id, multiA);
    await expect(grantAttempt(student.id, multiB.setId, staffId)).rejects.toMatchObject({ code: "result_pending" });
    expect(await grantCount(student.id)).toBe(1);

    // After the failed release the curriculum is blocked with no stray grant; staff can then grant B.
    await releaseAttempt(held, staffId);
    expect(await assignmentStatus(student.id, multiA)).toBe("blocked");
    expect(await grantAttempt(student.id, multiB.setId, staffId)).toEqual({ ok: true });
    expect(await assignmentStatus(student.id, multiA)).toBe("open");
  });

  it("refuses a grant on another exam set of the curriculum while one is in progress", async () => {
    const student = await makeStudent(multiA);
    expect(await grantAttempt(student.id, multiA.setId, staffId)).toEqual({ ok: true });
    await startAttempt(student.id, multiA.setId);
    await expect(grantAttempt(student.id, multiB.setId, staffId)).rejects.toMatchObject({ code: "in_progress" });
  });

  it("an expired attempt on another exam set of the curriculum is closed first and does not count as in progress", async () => {
    const student = await makeStudent(multiA);
    expect(await grantAttempt(student.id, multiA.setId, staffId)).toEqual({ ok: true });
    const { attemptId } = await startAttempt(student.id, multiA.setId);
    // Time is up on multiA, but nothing has read the attempt since.
    await ok(db.from("attempts").update({ deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", attemptId));
    const outcome = await grantAttempt(student.id, multiB.setId, staffId).catch((e: unknown) => e);
    expect((outcome as GrantError).code).not.toBe("in_progress");
    const row = await must(db.from("attempts").select("status").eq("id", attemptId).single());
    expect(row.status).not.toBe("in_progress");
  });

  it("recovers a blocked student who already holds an unused grant: unblocks without stacking", async () => {
    const student = await makeStudent(small);
    await failAndRelease(student.id, small);
    await failAndRelease(student.id, small);
    expect(await assignmentStatus(student.id, small)).toBe("blocked");
    // Legacy or racing state: an unused grant next to the block.
    await ok(db.from("attempt_grants").insert({ student_id: student.id, exam_set_id: small.setId, granted_by: staffId }));
    const before = await grantCount(student.id);

    expect(await grantAttempt(student.id, small.setId, staff2Id)).toEqual({ ok: true });
    expect(await assignmentStatus(student.id, small)).toBe("open");
    expect(await grantCount(student.id)).toBe(before);
    expect(await studentSees(student.client, small)).toBe("open");
  });

  it("rejects ids that are not uuids", async () => {
    await expect(grantAttempt("nope", small.setId, staffId)).rejects.toThrow();
    await expect(grantAttempt(randomUUID(), "nope", staffId)).rejects.toThrow();
    await expect(grantAttempt(randomUUID(), small.setId, "nope")).rejects.toThrow();
  });

  it("a student without a grant still cannot start (attempts are never automatic)", async () => {
    const student = await makeStudent(small);
    await expect(startAttempt(student.id, small.setId)).rejects.toEqual(new AttemptError("no_grant"));
  });
});

describe("grant_attempt and grantAttemptAction with real sessions", () => {
  it("a student session cannot call grant_attempt directly", async () => {
    const student = await makeStudent(small);
    const { error } = await student.client.rpc("grant_attempt", {
      p_student_id: student.id,
      p_exam_set_id: small.setId,
      p_staff_id: staffId,
    });
    expect(error?.code).toBe("42501");
    expect(await grantCount(student.id)).toBe(0);
  });

  it("a staff session cannot call grant_attempt directly either (service role only)", async () => {
    const student = await makeStudent(small);
    const { error } = await staffClient.rpc("grant_attempt", {
      p_student_id: student.id,
      p_exam_set_id: small.setId,
      p_staff_id: staffId,
    });
    expect(error?.code).toBe("42501");
    expect(await grantCount(student.id)).toBe(0);
  });

  it("the action rejects a student session and creates nothing", async () => {
    const student = await makeStudent(small);
    session.client = student.client;
    await expect(grantAttemptAction(student.id, small.setId)).rejects.toThrow("REDIRECT /exam/start");
    expect(await grantCount(student.id)).toBe(0);
  });

  it("the action redirects without a session", async () => {
    const student = await makeStudent(small);
    session.client = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await expect(grantAttemptAction(student.id, small.setId)).rejects.toThrow("REDIRECT /login");
    expect(await grantCount(student.id)).toBe(0);
  });

  it("a staff session grants as itself, ignoring any extra arguments", async () => {
    const student = await makeStudent(small);
    session.client = staffClient;
    const action = grantAttemptAction as unknown as (...args: unknown[]) => Promise<unknown>;
    await expect(action(student.id, small.setId, staff2Id)).resolves.toEqual({ ok: true });
    const grants = await must(db.from("attempt_grants").select("granted_by").eq("student_id", student.id));
    expect(grants).toEqual([{ granted_by: staffId }]);
  });

  it("the action reports the shortfall and typed refusals", async () => {
    const student = await makeStudent(small);
    await failAndRelease(student.id, small);
    await failAndRelease(student.id, small);
    session.client = staffClient;
    await expect(grantAttemptAction(student.id, small.setId)).resolves.toEqual({
      ok: false,
      error: "shortfall",
      unseenAvailable: 1,
      needed: 2,
    });
    const other = await makeStudent(small);
    await expect(grantAttemptAction(other.id, small.setId)).resolves.toEqual({ ok: true });
    await expect(grantAttemptAction(other.id, small.setId)).resolves.toEqual({ ok: false, error: "grant_exists" });
    const held = await makeStudent(small);
    await expect(grantAttemptAction(held.id, small.setId)).resolves.toEqual({ ok: true });
    await takeAttempt(held.id, small);
    await expect(grantAttemptAction(held.id, small.setId)).resolves.toEqual({ ok: false, error: "result_pending" });
    await expect(grantAttemptAction("../x", small.setId)).resolves.toEqual({ ok: false, error: "invalid_request" });
  });
});

describe("staff overview readers", () => {
  it("list blocked students with curriculum, exam set, attempts used of max, last score and batch", async () => {
    const student = await makeStudent(small, `Batch ${run}`);
    await failAndRelease(student.id, small);
    await failAndRelease(student.id, small);
    session.client = staffClient;

    const row = (await listBlockedStudents()).find((r) => r.studentId === student.id);
    expect(row).toEqual({
      studentId: student.id,
      studentName: student.name,
      batch: `Batch ${run}`,
      curriculumId: small.curriculumId,
      curriculumName: small.name,
      examSetId: small.setId,
      examSetName: `${small.name} set`,
      attemptsUsed: 2,
      maxAttempts: 2,
      lastPoints: 0,
      lastMaxPoints: 2,
      lastAttemptAt: expect.any(String),
    });

    const dashboard = await getDashboard();
    expect(dashboard.blockedTotal).toBeGreaterThanOrEqual(1);
    expect(dashboard.byStatus.blocked).toBeGreaterThanOrEqual(1);
    expect(dashboard.blockedPreview.length).toBeLessThanOrEqual(5);
    expect(dashboard.studentTotal).toBeGreaterThanOrEqual(dashboard.byStatus.blocked);
  });

  it("list students who can be given an attempt: open, no unused grant, nothing in progress or held", async () => {
    const fresh = await makeStudent(big);
    const granted = await makeStudent(big);
    expect(await grantAttempt(granted.id, big.setId, staffId)).toEqual({ ok: true });
    const failedOnce = await makeStudent(big);
    await failAndRelease(failedOnce.id, big);
    const held = await makeStudent(big);
    expect(await grantAttempt(held.id, big.setId, staffId)).toEqual({ ok: true });
    await takeAttempt(held.id, big);
    session.client = staffClient;

    const rows = (await listGrantable()).filter((r) => [fresh.id, granted.id, failedOnce.id, held.id].includes(r.studentId));
    expect(rows.map((r) => r.studentId).sort()).toEqual([fresh.id, failedOnce.id].sort());
    expect(rows.find((r) => r.studentId === failedOnce.id)).toMatchObject({
      examSetId: big.setId,
      curriculumName: big.name,
      attemptsUsed: 1,
      maxAttempts: 2,
    });
    expect(rows.find((r) => r.studentId === fresh.id)).toMatchObject({ attemptsUsed: 0 });
  });

  it("hide the whole curriculum while any attempt in it is held or in progress", async () => {
    const held = await makeStudent(multiA);
    expect(await grantAttempt(held.id, multiA.setId, staffId)).toEqual({ ok: true });
    await takeAttempt(held.id, multiA);
    const running = await makeStudent(multiA);
    expect(await grantAttempt(running.id, multiA.setId, staffId)).toEqual({ ok: true });
    await startAttempt(running.id, multiA.setId);
    const fresh = await makeStudent(multiA);
    session.client = staffClient;

    const rows = (await listGrantable()).filter((r) => [held.id, running.id, fresh.id].includes(r.studentId));
    expect(rows.filter((r) => r.studentId === held.id)).toEqual([]);
    expect(rows.filter((r) => r.studentId === running.id)).toEqual([]);
    expect(rows.filter((r) => r.studentId === fresh.id).map((r) => r.examSetId).sort()).toEqual(
      [multiA.setId, multiB.setId].sort(),
    );
  });

  it("a student session gets nothing from the readers", async () => {
    const student = await makeStudent(small);
    await failAndRelease(student.id, small);
    await failAndRelease(student.id, small);
    session.client = student.client;
    expect(await listBlockedStudents()).toEqual([]);
    expect(await listGrantable()).toEqual([]);
  });
});
