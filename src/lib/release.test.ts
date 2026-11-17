// Integration tests for staff release, the student result and the staff review readers.
// They run against the LOCAL Supabase stack with throwaway users and exam sets. Student and
// staff sessions are real (password sign-in with the anon key), so RLS and the student views
// are exercised exactly as in the app. Only the Next.js request plumbing is replaced:
// createClient() returns the signed-in client of the current test, redirect() throws.
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

import { saveAnswer, startAttempt, submitAttempt } from "./attempts";
import { releaseAttempt } from "./release";
import { getStudentResult } from "./results";
import { getAttemptReview, listResults, listSubmittedAttempts } from "./review";
import { getStudentDetail } from "./staff-manage";
import { releaseAttemptAction } from "@/app/staff/review/actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
let curriculumId = "";
let setId = "";
let staffId = "";
let staff2Id = "";
let staffClient: SupabaseClient;
let staff2Client: SupabaseClient;

const OPTIONS = [
  { id: "a", de: "Ja", en: "Yes" },
  { id: "b", de: "Nein", en: "No" },
  { id: "c", de: "Vielleicht", en: "Maybe" },
];
// Four questions, all drawn: topic "recht" 1 + 2 points, topic "alltag" 3 + 1 points. Key: "b".
const QUESTIONS = [
  { topic: "recht", points: 1 },
  { topic: "recht", points: 2 },
  { topic: "alltag", points: 3 },
  { topic: "alltag", points: 1 },
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

let counter = 0;
async function makeUser(role: "student" | "staff"): Promise<{ id: string; name: string; client: SupabaseClient }> {
  counter += 1;
  const username = `t6.${run}.${role}.${counter}`;
  const email = `${username}@${role === "staff" ? "staff" : "students"}.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: `T6 ${role} ${counter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  if (role === "student") {
    await ok(db.from("assignments").insert({ student_id: data.user.id, curriculum_id: curriculumId, position: 1 }));
    await ok(db.from("attempt_grants").insert({ student_id: data.user.id, exam_set_id: setId }));
  }
  const client = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, name: `T6 ${role} ${counter}`, client };
}

/** A held, scored, submitted attempt. answers: option per paper position (default all correct). */
async function submittedAttempt(studentId: string, choose: (topic: string, points: number) => string = () => "b") {
  const { attemptId } = await startAttempt(studentId, setId);
  const paper = (await must(
    db.from("attempt_questions").select("id, questions(topic, points)").eq("attempt_id", attemptId),
  )) as unknown as { id: string; questions: { topic: string; points: number } }[];
  for (const q of paper) await saveAnswer(studentId, attemptId, q.id, choose(q.questions.topic, q.questions.points));
  await submitAttempt(attemptId);
  return attemptId;
}

/** Topic rows (student) and per-question points (staff) must add up to the stored total. */
function expectTopicsAddUp(result: { points: number; maxPoints: number; topics: { points: number; max: number }[] }) {
  expect(result.topics.reduce((s, t) => s + t.points, 0)).toBe(result.points);
  expect(result.topics.reduce((s, t) => s + t.max, 0)).toBe(result.maxPoints);
}

/** Staff edit every question of the set after scoring: new key, new points, new topic. */
async function editQuestions() {
  await ok(db.from("questions").update({ correct_option_id: "a", points: 10, topic: "geändert" }).eq("exam_set_id", setId));
}
async function restoreQuestions() {
  const rows = await must(db.from("questions").select("id, stem_de").eq("exam_set_id", setId));
  for (const r of rows) {
    const i = Number(/Frage (\d+)/.exec(r.stem_de)![1]) - 1;
    await ok(db.from("questions").update({ correct_option_id: "b", ...QUESTIONS[i] }).eq("id", r.id));
  }
}

async function attemptRow(attemptId: string) {
  return must(db.from("attempts").select("*").eq("id", attemptId).single());
}

beforeAll(async () => {
  const curriculum = await must(db.from("curriculums").insert({ name: `T6 curriculum ${run}` }).select("id").single());
  curriculumId = curriculum.id;
  const set = await must(
    db
      .from("exam_sets")
      .insert({
        curriculum_id: curriculumId,
        name: `T6 set ${run}`,
        question_count: 4,
        time_limit_min: 20,
        pass_mark_percent: 60,
        max_attempts: 3,
        hold_result: true,
      })
      .select("id")
      .single(),
  );
  setId = set.id;
  await ok(
    db.from("questions").insert(
      QUESTIONS.map((q, i) => ({
        exam_set_id: setId,
        topic: q.topic,
        difficulty: "easy",
        stem_de: `Frage ${i + 1} ${run}`,
        stem_en: `Question ${i + 1} ${run}`,
        options: OPTIONS,
        correct_option_id: "b",
        points: q.points,
        status: "approved",
      })),
    ),
  );
  ({ id: staffId, client: staffClient } = await makeUser("staff"));
  ({ id: staff2Id, client: staff2Client } = await makeUser("staff"));
});

afterAll(async () => {
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  if (curriculumId) await db.from("curriculums").delete().eq("id", curriculumId);
});

beforeEach(() => {
  session.client = null;
});

describe("before release (RLS, real student session)", () => {
  it("a student reading a submitted attempt gets no points, max_points or passed", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    expect((await attemptRow(attemptId)).points).toBe(7); // scored and stored, but held

    const viaView = await must(
      student.client.from("student_attempts").select("status, points, max_points, passed").eq("id", attemptId).single(),
    );
    expect(viaView).toEqual({ status: "submitted", points: null, max_points: null, passed: null });
    const direct = await student.client.from("attempts").select("points").eq("id", attemptId);
    expect(direct.data).toEqual([]);
    const assignment = await must(
      student.client.from("student_assignments").select("status").eq("curriculum_id", curriculumId).single(),
    );
    expect(assignment.status).toBe("open");
  });

  it("the student result reader returns no numbers, topics or key while unreleased", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = student.client;
    const result = await getStudentResult(student.id, attemptId);
    expect(result).toMatchObject({ status: "submitted", id: attemptId });
    const json = JSON.stringify(result);
    for (const forbidden of ["points", "maxPoints", "percent", "passed", "topics", "correct", "recht", "alltag"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe("releaseAttempt", () => {
  it("releases a held attempt, records the staff member and marks the assignment passed (seen by the student)", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    const before = await attemptRow(attemptId);

    await expect(releaseAttempt(attemptId, staffId)).resolves.toBe(true);

    const after = await attemptRow(attemptId);
    expect(after).toMatchObject({ status: "released", released_by: staffId, points: before.points, max_points: 7, passed: true });
    expect(after.released_at).not.toBeNull();
    const viaView = await must(
      student.client.from("student_attempts").select("points, max_points, passed").eq("id", attemptId).single(),
    );
    expect(viaView).toEqual({ points: 7, max_points: 7, passed: true });
    const assignment = await must(
      student.client.from("student_assignments").select("status").eq("curriculum_id", curriculumId).single(),
    );
    expect(assignment.status).toBe("passed");
  });

  it("releasing an already released attempt is a no-op (row unchanged, releaser kept)", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    await releaseAttempt(attemptId, staffId);
    const released = await attemptRow(attemptId);
    await expect(releaseAttempt(attemptId, staff2Id)).resolves.toBe(false);
    expect(await attemptRow(attemptId)).toEqual(released);
  });

  it("an in-progress attempt is not released", async () => {
    const student = await makeUser("student");
    const { attemptId } = await startAttempt(student.id, setId);
    await expect(releaseAttempt(attemptId, staffId)).resolves.toBe(false);
    expect((await attemptRow(attemptId)).status).toBe("in_progress");
  });

  it("rejects a releaser who is not staff and releases nothing", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    await expect(releaseAttempt(attemptId, student.id)).rejects.toThrow(/not_staff/);
    expect((await attemptRow(attemptId)).status).toBe("submitted");
  });

  it("rejects ids that are not uuids", async () => {
    await expect(releaseAttempt("nope", staffId)).rejects.toThrow();
    await expect(releaseAttempt(randomUUID(), "nope")).rejects.toThrow();
  });
});

describe("staff cannot change points", () => {
  it("an authenticated staff session cannot update points", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    const { error } = await staffClient.from("attempts").update({ points: 0 }).eq("id", attemptId);
    expect(error?.code).toBe("42501");
    expect((await attemptRow(attemptId)).points).toBe(7);
  });

  it("the release action takes only the attempt id: extra arguments cannot change the score", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = staffClient;
    const action = releaseAttemptAction as unknown as (...args: unknown[]) => Promise<unknown>;
    await expect(action(attemptId, { points: 0, passed: false }, { points: 0 })).resolves.toEqual({ ok: true });
    expect(await attemptRow(attemptId)).toMatchObject({ status: "released", points: 7, max_points: 7, passed: true });
  });
});

describe("releaseAttemptAction", () => {
  it("a student session is rejected and nothing is released", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = student.client;
    await expect(releaseAttemptAction(attemptId)).rejects.toThrow("REDIRECT /exam/start");
    expect(await attemptRow(attemptId)).toMatchObject({ status: "submitted", released_by: null });
  });

  it("without a session it redirects to login", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await expect(releaseAttemptAction(attemptId)).rejects.toThrow("REDIRECT /login");
    expect((await attemptRow(attemptId)).status).toBe("submitted");
  });

  it("a staff session releases and is recorded as the releaser (from the session)", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = staff2Client;
    await expect(releaseAttemptAction(attemptId)).resolves.toEqual({ ok: true });
    expect(await attemptRow(attemptId)).toMatchObject({ status: "released", released_by: staff2Id });
  });

  it("an attempt that changes nothing (already released) is reported, not shown as a success", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = staffClient;
    await expect(releaseAttemptAction(attemptId)).resolves.toEqual({ ok: true });
    await expect(releaseAttemptAction(attemptId)).resolves.toEqual({ ok: false, error: "not_releasable" });
  });

  it("an in-progress (not scored) attempt is reported as not releasable", async () => {
    const student = await makeUser("student");
    const { attemptId } = await startAttempt(student.id, setId);
    session.client = staffClient;
    await expect(releaseAttemptAction(attemptId)).resolves.toEqual({ ok: false, error: "not_releasable" });
  });

  it("an invalid id is refused without touching the database", async () => {
    session.client = staffClient;
    await expect(releaseAttemptAction("../x")).resolves.toEqual({ ok: false, error: "invalid_request" });
  });
});

describe("getStudentResult after release", () => {
  it("returns score, pass and a per-topic breakdown that adds up, without any answer key", async () => {
    const student = await makeUser("student");
    // Wrong only on the 3-point "alltag" question: 4 of 7.
    const attemptId = await submittedAttempt(student.id, (topic, points) => (topic === "alltag" && points === 3 ? "a" : "b"));
    await releaseAttempt(attemptId, staffId);
    session.client = student.client;

    const result = await getStudentResult(student.id, attemptId);
    expect(result).toMatchObject({
      status: "released",
      points: 4,
      maxPoints: 7,
      passed: false,
      percent: 57.1,
      examSetName: `T6 set ${run}`,
      curriculumName: `T6 curriculum ${run}`,
    });
    if (result?.status !== "released") throw new Error("expected a released result");
    expect(result.topics).toEqual([
      { topic: "alltag", points: 1, max: 4 },
      { topic: "recht", points: 3, max: 3 },
    ]);
    expectTopicsAddUp(result);
    const json = JSON.stringify(result);
    expect(json).not.toContain("correct");
    expect(json).not.toContain("option");
    expect(json).not.toContain(student.id);
  });

  it("questions edited after scoring change neither the breakdown nor the staff evaluation", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id, (topic, points) => (topic === "alltag" && points === 3 ? "a" : "b"));
    await editQuestions();
    try {
      session.client = staffClient;
      const review = await getAttemptReview(attemptId);
      expect(review).toMatchObject({ points: 4, maxPoints: 7 });
      expect(review!.questions.reduce((s, q) => s + (q.awardedPoints ?? 0), 0)).toBe(4);
      expect(review!.questions.reduce((s, q) => s + (q.maxPoints ?? 0), 0)).toBe(7);
      for (const q of review!.questions) {
        expect(q.correctOptionId).toBe("b");
        expect(q.topic).not.toBe("geändert");
      }
      // The answer "a" now matches the live key, but it was wrong when scored.
      const wrong = review!.questions.find((q) => q.chosenOptionId === "a")!;
      expect(wrong).toMatchObject({ awardedPoints: 0, maxPoints: 3, topic: "alltag" });

      await releaseAttempt(attemptId, staffId);
      session.client = student.client;
      const result = await getStudentResult(student.id, attemptId);
      if (result?.status !== "released") throw new Error("expected a released result");
      expect(result).toMatchObject({ points: 4, maxPoints: 7 });
      expect(result.topics).toEqual([
        { topic: "alltag", points: 1, max: 4 },
        { topic: "recht", points: 3, max: 3 },
      ]);
      expectTopicsAddUp(result);
    } finally {
      await restoreQuestions();
    }
  });

  it("a student cannot read another student's released attempt", async () => {
    const owner = await makeUser("student");
    const other = await makeUser("student");
    const attemptId = await submittedAttempt(owner.id);
    await releaseAttempt(attemptId, staffId);

    const viaView = await other.client.from("student_attempts").select("id, points").eq("id", attemptId);
    expect(viaView.data).toEqual([]);
    const direct = await other.client.from("attempts").select("id, points").eq("id", attemptId);
    expect(direct.data).toEqual([]);

    session.client = other.client;
    expect(await getStudentResult(other.id, attemptId)).toBeNull();
    // Even a forged student id does not help: the view filters by the session's auth.uid().
    expect(await getStudentResult(owner.id, attemptId)).toBeNull();
  });

  it("returns null for ids that are not uuids", async () => {
    const student = await makeUser("student");
    session.client = student.client;
    expect(await getStudentResult(student.id, "not-a-uuid")).toBeNull();
  });
});

describe("staff review readers", () => {
  it("list submitted attempts newest first with student, curriculum, set and score; released ones drop out", async () => {
    const first = await makeUser("student");
    const second = await makeUser("student");
    const older = await submittedAttempt(first.id);
    const newer = await submittedAttempt(second.id, () => "a");
    session.client = staffClient;

    const list = await listSubmittedAttempts();
    const mine = list.filter((r) => r.id === older || r.id === newer);
    expect(mine.map((r) => r.id)).toEqual([newer, older]);
    expect(mine[1]).toMatchObject({
      studentName: first.name,
      curriculumName: `T6 curriculum ${run}`,
      examSetName: `T6 set ${run}`,
      points: 7,
      maxPoints: 7,
      passed: true,
    });
    expect(mine[1].submittedAt).toBeTruthy();

    await releaseAttempt(older, staffId);
    expect((await listSubmittedAttempts()).some((r) => r.id === older)).toBe(false);
  });

  it("the evaluation view shows each question in German and English with chosen, correct and awarded points", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id, (topic, points) => (topic === "alltag" && points === 3 ? "c" : "b"));
    session.client = staffClient;

    const review = await getAttemptReview(attemptId);
    expect(review).toMatchObject({ id: attemptId, status: "submitted", points: 4, maxPoints: 7, passed: false });
    expect(review!.questions.reduce((s, q) => s + (q.awardedPoints ?? 0), 0)).toBe(review!.points);
    expect(review!.questions.reduce((s, q) => s + (q.maxPoints ?? 0), 0)).toBe(review!.maxPoints);
    expect(review!.questions).toHaveLength(4);
    expect(review!.questions.map((q) => q.position)).toEqual([1, 2, 3, 4]);
    for (const q of review!.questions) {
      expect(q.stemDe).toMatch(/^Frage \d/);
      expect(q.stemEn).toBe(q.stemDe.replace("Frage", "Question"));
      expect(q.correctOptionId).toBe("b");
      expect(q.options.map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
      expect(q.options.find((o) => o.id === "c")).toEqual({ id: "c", de: "Vielleicht", en: "Maybe" });
      const wrong = q.topic === "alltag" && q.maxPoints === 3;
      expect(q.chosenOptionId).toBe(wrong ? "c" : "b");
      expect(q.awardedPoints).toBe(wrong ? 0 : q.maxPoints);
    }
  });

  it("a student session gets nothing from the staff readers", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = student.client;
    expect(await listSubmittedAttempts()).toEqual([]);
    expect(await getAttemptReview(attemptId)).toBeNull();
  });
});

describe("staff results list", () => {
  it("lists held and released attempts (not in progress) with batch, filterable by batch, curriculum and status", async () => {
    const batch = `B-${run}`;
    const heldStudent = await makeUser("student");
    const releasedStudent = await makeUser("student");
    await db.from("profiles").update({ batch }).in("id", [heldStudent.id, releasedStudent.id]);
    const held = await submittedAttempt(heldStudent.id);
    const released = await submittedAttempt(releasedStudent.id, () => "a");
    await releaseAttempt(released, staffId);
    const runner = await makeUser("student");
    await db.from("profiles").update({ batch }).eq("id", runner.id);
    await ok(db.from("attempt_grants").insert({ student_id: runner.id, exam_set_id: setId }));
    const { attemptId: running } = await startAttempt(runner.id, setId);
    session.client = staffClient;

    const all = await listResults({ batch });
    expect(all.rows.map((r) => r.id).sort()).toEqual([held, released].sort());
    expect(all.rows.find((r) => r.id === running)).toBeUndefined();
    expect(all.rows.find((r) => r.id === released)).toMatchObject({
      status: "released",
      batch,
      curriculumName: `T6 curriculum ${run}`,
      examSetName: `T6 set ${run}`,
      points: 0,
      maxPoints: 7,
      passed: false,
    });
    expect(all.rows.find((r) => r.id === held)).toMatchObject({ status: "submitted", points: 7, passed: true });
    expect(all.batches).toContain(batch);
    expect(all.curriculums).toContainEqual({ id: curriculumId, name: `T6 curriculum ${run}` });

    expect((await listResults({ batch, status: "released" })).rows.map((r) => r.id)).toEqual([released]);
    expect((await listResults({ batch, status: "submitted" })).rows.map((r) => r.id)).toEqual([held]);
    expect((await listResults({ batch, curriculumId })).rows).toHaveLength(2);
    expect((await listResults({ batch, curriculumId: randomUUID() })).rows).toEqual([]);
  });

  it("a student session gets no rows", async () => {
    const student = await makeUser("student");
    await submittedAttempt(student.id);
    session.client = student.client;
    expect((await listResults({})).rows).toEqual([]);
  });

  it("the student detail lists each attempt with status and score", async () => {
    const student = await makeUser("student");
    const attemptId = await submittedAttempt(student.id);
    session.client = staffClient;
    const before = await getStudentDetail(student.id);
    expect(before!.results).toEqual([
      expect.objectContaining({ id: attemptId, status: "submitted", points: 7, maxPoints: 7, passed: true, examSetName: `T6 set ${run}` }),
    ]);
    await releaseAttempt(attemptId, staffId);
    expect((await getStudentDetail(student.id))!.results[0]).toMatchObject({ id: attemptId, status: "released" });
  });
});
