// Integration tests for the attempt lifecycle. They run against the LOCAL Supabase stack
// (npm run db:start) with the service role, using throwaway users and exam sets that are
// removed again in afterAll. Deadlines are tested by moving deadline_at into the past.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AttemptError,
  getAttemptForStudent,
  saveAnswer,
  startAttempt,
  submitAttempt,
  sweepExpired,
} from "./attempts";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
const curriculumIds: string[] = [];
let heldSetId = "";
let openSetId = "";
let heldCurriculumId = "";
let openCurriculumId = "";

const OPTIONS = [
  { id: "a", de: "Ja", en: "Yes" },
  { id: "b", de: "Nein", en: "No" },
  { id: "c", de: "Vielleicht", en: "Maybe" },
];

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

async function makeExamSet(name: string, holdResult: boolean) {
  const curriculum = await must(
    db.from("curriculums").insert({ name: `T5 ${name} ${run}` }).select("id").single(),
  );
  curriculumIds.push(curriculum.id);
  const set = await must(
    db
      .from("exam_sets")
      .insert({
        curriculum_id: curriculum.id,
        name: `T5 ${name} set`,
        question_count: 3,
        time_limit_min: 20,
        pass_mark_percent: 60,
        max_attempts: 3,
        hold_result: holdResult,
      })
      .select("id")
      .single(),
  );
  // 6 approved questions (two full papers without repeats) plus one draft that is never drawn.
  // Points are 1, 2, 3, 1, 2, 3 so tests can tell which answers were scored.
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    exam_set_id: set.id,
    topic: n % 2 ? "recht" : "alltag",
    difficulty: "easy",
    stem_de: `Frage ${n} (${name})`,
    stem_en: `Question ${n} (${name})`,
    options: OPTIONS,
    correct_option_id: "b",
    points: ((n - 1) % 3) + 1,
    status: n === 7 ? "draft" : "approved",
  }));
  await ok(db.from("questions").insert(rows));
  return { curriculumId: curriculum.id as string, setId: set.id as string };
}

async function ok(p: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await p;
  if (error) throw error;
}

let studentCounter = 0;
async function makeStudent(): Promise<string> {
  studentCounter += 1;
  const username = `t5.${run}.${studentCounter}`;
  const { data, error } = await db.auth.admin.createUser({
    email: `${username}@students.test`,
    password: randomUUID(),
    email_confirm: true,
    app_metadata: { role: "student", username, full_name: `T5 Student ${studentCounter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  await ok(
    db.from("assignments").insert([
      { student_id: data.user.id, curriculum_id: heldCurriculumId, position: 1 },
      { student_id: data.user.id, curriculum_id: openCurriculumId, position: 2 },
    ]),
  );
  return data.user.id;
}

async function grant(studentId: string, examSetId: string) {
  await ok(db.from("attempt_grants").insert({ student_id: studentId, exam_set_id: examSetId }));
}

async function attemptRow(attemptId: string) {
  return must(db.from("attempts").select("*").eq("id", attemptId).single());
}

async function paper(attemptId: string) {
  const rows = await must(
    db
      .from("attempt_questions")
      .select("id, question_id, position, option_order, questions(points)")
      .eq("attempt_id", attemptId)
      .order("position"),
  );
  return rows as unknown as {
    id: string;
    question_id: string;
    position: number;
    option_order: string[];
    questions: { points: number };
  }[];
}

async function expire(attemptId: string) {
  await ok(
    db
      .from("attempts")
      .update({
        started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
        deadline_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", attemptId),
  );
}

async function assignmentStatus(studentId: string, curriculumId: string) {
  const row = await must(
    db.from("assignments").select("status").eq("student_id", studentId).eq("curriculum_id", curriculumId).single(),
  );
  return row.status as string;
}

beforeAll(async () => {
  const held = await makeExamSet("held", true);
  const open = await makeExamSet("open", false);
  heldSetId = held.setId;
  heldCurriculumId = held.curriculumId;
  openSetId = open.setId;
  openCurriculumId = open.curriculumId;
});

afterAll(async () => {
  // Deleting the users cascades profiles, attempts, attempt_questions, answers, grants, assignments.
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  if (curriculumIds.length) await db.from("curriculums").delete().in("id", curriculumIds);
});

describe("startAttempt", () => {
  it("throws when the student has no unused grant", async () => {
    const student = await makeStudent();
    await expect(startAttempt(student, heldSetId)).rejects.toMatchObject({ code: "no_grant" });
    const attempts = await must(db.from("attempts").select("id").eq("student_id", student));
    expect(attempts).toHaveLength(0);
  });

  it("claims the grant, stores the draw and sets the deadline from the time limit (database time)", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);

    const row = await attemptRow(attemptId);
    expect(row.status).toBe("in_progress");
    expect(new Date(row.deadline_at).getTime() - new Date(row.started_at).getTime()).toBe(20 * 60_000);

    const questions = await paper(attemptId);
    expect(questions.map((q) => q.position)).toEqual([1, 2, 3]);
    for (const q of questions) expect([...q.option_order].sort()).toEqual(["a", "b", "c"]);

    const grants = await must(db.from("attempt_grants").select("used_attempt_id").eq("student_id", student));
    expect(grants).toEqual([{ used_attempt_id: attemptId }]);
  });

  it("returns the existing in-progress attempt instead of starting a second one", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    await grant(student, heldSetId);
    const first = await startAttempt(student, heldSetId);
    const second = await startAttempt(student, heldSetId);
    expect(second.attemptId).toBe(first.attemptId);
    const unused = await must(
      db.from("attempt_grants").select("id").eq("student_id", student).is("used_attempt_id", null),
    );
    expect(unused).toHaveLength(1);
  });

  it("two concurrent starts with one grant create exactly one attempt", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const results = await Promise.allSettled([startAttempt(student, heldSetId), startAttempt(student, heldSetId)]);
    const attempts = await must(db.from("attempts").select("id").eq("student_id", student));
    expect(attempts).toHaveLength(1);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of ok) expect(r.value.attemptId).toBe(attempts[0].id);
  });

  it("a granted retake never reuses questions the student has seen in that exam set", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const first = await startAttempt(student, heldSetId);
    await submitAttempt(first.attemptId);
    // A retake only starts once the held result is released (start_attempt refuses result_pending, 0013).
    const { error: releaseError } = await db.rpc("release_attempt", { p_attempt_id: first.attemptId, p_released_by: null });
    if (releaseError) throw releaseError;
    await grant(student, heldSetId);
    const second = await startAttempt(student, heldSetId);
    const seen = new Set((await paper(first.attemptId)).map((q) => q.question_id));
    const again = (await paper(second.attemptId)).map((q) => q.question_id);
    expect(again).toHaveLength(3);
    for (const id of again) expect(seen.has(id)).toBe(false);
  });
});

describe("resume", () => {
  it("returns the same questions, option order and deadline when an attempt is read again", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);

    const first = await getAttemptForStudent(student, attemptId);
    const resumed = await getAttemptForStudent(student, (await startAttempt(student, heldSetId)).attemptId);
    expect(first).not.toBeNull();
    expect(resumed!.deadlineAt).toBe(first!.deadlineAt);
    expect(resumed!.questions).toEqual(first!.questions);
    // Option order shown to the student follows attempt_questions.option_order; no answer key leaks.
    const stored = await paper(attemptId);
    expect(first!.questions.map((q) => q.options.map((o) => o.id))).toEqual(stored.map((q) => q.option_order));
    expect(JSON.stringify(first)).not.toMatch(/correct|"points"/);
    expect(first!.questions[0].stemDe).toMatch(/^Frage/);
  });

  it("returns null for another student's attempt", async () => {
    const owner = await makeStudent();
    const other = await makeStudent();
    await grant(owner, heldSetId);
    const { attemptId } = await startAttempt(owner, heldSetId);
    expect(await getAttemptForStudent(other, attemptId)).toBeNull();
  });

  it("reading an expired in-progress attempt submits it (lazy expiry)", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    await expire(attemptId);
    const view = await getAttemptForStudent(student, attemptId);
    expect(view!.status).toBe("submitted");
    expect((await attemptRow(attemptId)).status).toBe("submitted");
  });
});

describe("saveAnswer", () => {
  it("saves and overwrites the chosen option for the calling student's open attempt", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    const [q1] = await paper(attemptId);
    await saveAnswer(student, attemptId, q1.id, "a");
    await saveAnswer(student, attemptId, q1.id, "c");
    const rows = await must(db.from("answers").select("option_id").eq("attempt_question_id", q1.id));
    expect(rows).toEqual([{ option_id: "c" }]);
    const view = await getAttemptForStudent(student, attemptId);
    expect(view!.answers[q1.id]).toBe("c");
  });

  it("throws after the deadline and auto-submits the attempt", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    const [q1] = await paper(attemptId);
    await expire(attemptId);
    await expect(saveAnswer(student, attemptId, q1.id, "b")).rejects.toMatchObject({ code: "deadline_passed" });
    const rows = await must(db.from("answers").select("option_id").eq("attempt_question_id", q1.id));
    expect(rows).toHaveLength(0);
    expect((await attemptRow(attemptId)).status).toBe("submitted");
  });

  it("rejects an option id that does not belong to the question", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    const [q1] = await paper(attemptId);
    await expect(saveAnswer(student, attemptId, q1.id, "z")).rejects.toMatchObject({ code: "invalid_option" });
    const rows = await must(db.from("answers").select("option_id").eq("attempt_question_id", q1.id));
    expect(rows).toHaveLength(0);
  });

  it("a student cannot save into another student's attempt", async () => {
    const owner = await makeStudent();
    const intruder = await makeStudent();
    await grant(owner, heldSetId);
    const { attemptId } = await startAttempt(owner, heldSetId);
    const [q1] = await paper(attemptId);
    await expect(saveAnswer(intruder, attemptId, q1.id, "b")).rejects.toMatchObject({ code: "not_found" });
    const rows = await must(db.from("answers").select("option_id").eq("attempt_question_id", q1.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects saving after the attempt is submitted", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    const [q1] = await paper(attemptId);
    await submitAttempt(attemptId);
    await expect(saveAnswer(student, attemptId, q1.id, "b")).rejects.toMatchObject({ code: "closed" });
  });
});

describe("submitAttempt", () => {
  it("is idempotent: submitting twice leaves one score and one state change", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    const questions = await paper(attemptId);
    await saveAnswer(student, attemptId, questions[0].id, "b");

    await submitAttempt(attemptId);
    const once = await attemptRow(attemptId);
    await submitAttempt(attemptId);
    const twice = await attemptRow(attemptId);

    expect(once.status).toBe("submitted");
    expect(once.points).toBe(questions[0].questions.points);
    expect(once.max_points).toBe(questions.reduce((s, q) => s + q.questions.points, 0));
    expect(twice).toEqual(once);
  });

  it("a submit after the deadline scores only answers saved before the deadline", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    const [q1, q2] = await paper(attemptId);
    await saveAnswer(student, attemptId, q1.id, "b");
    await expire(attemptId);
    // q1 was saved before the deadline; q2 arrives after it (written directly, as a late save would).
    await ok(
      db
        .from("answers")
        .update({ saved_at: new Date(Date.now() - 2 * 60_000).toISOString() })
        .eq("attempt_question_id", q1.id),
    );
    await ok(db.from("answers").insert({ attempt_question_id: q2.id, option_id: "b" }));

    await submitAttempt(attemptId);
    const row = await attemptRow(attemptId);
    expect(row.points).toBe(q1.questions.points);
    expect(new Date(row.submitted_at).getTime()).toBe(new Date(row.deadline_at).getTime());
  });

  it("held result: stays submitted, nothing released, assignment unchanged", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    for (const q of await paper(attemptId)) await saveAnswer(student, attemptId, q.id, "b");
    await submitAttempt(attemptId);
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("submitted");
    expect(row.released_at).toBeNull();
    expect(row.passed).toBe(true);
    expect(await assignmentStatus(student, heldCurriculumId)).toBe("open");
  });

  it("non-held result: released at once and a pass marks the assignment passed", async () => {
    const student = await makeStudent();
    await grant(student, openSetId);
    const { attemptId } = await startAttempt(student, openSetId);
    for (const q of await paper(attemptId)) await saveAnswer(student, attemptId, q.id, "b");
    await submitAttempt(attemptId);
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("released");
    expect(row.released_at).not.toBeNull();
    expect(row.passed).toBe(true);
    expect(await assignmentStatus(student, openCurriculumId)).toBe("passed");
    expect(await assignmentStatus(student, heldCurriculumId)).toBe("open");
  });

  it("non-held result: a fail is released and leaves the assignment open", async () => {
    const student = await makeStudent();
    await grant(student, openSetId);
    const { attemptId } = await startAttempt(student, openSetId);
    await submitAttempt(attemptId);
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("released");
    expect(row.passed).toBe(false);
    expect(row.points).toBe(0);
    expect(await assignmentStatus(student, openCurriculumId)).toBe("open");
  });

  it("scores with the answer key read at submit time and ignores later staff edits", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    const [q1] = await paper(attemptId);
    await saveAnswer(student, attemptId, q1.id, "b");
    await submitAttempt(attemptId);
    const before = await attemptRow(attemptId);
    await ok(db.from("questions").update({ correct_option_id: "a" }).eq("id", q1.question_id));
    await submitAttempt(attemptId);
    expect(await attemptRow(attemptId)).toEqual(before);
    await ok(db.from("questions").update({ correct_option_id: "b" }).eq("id", q1.question_id));
  });
});

// Staff release with a recorded releaser is covered in release.test.ts; these use no releaser.
describe("release_attempt (lifecycle)", () => {
  const release = async (attemptId: string) => {
    const { data, error } = await db.rpc("release_attempt", { p_attempt_id: attemptId, p_released_by: null });
    if (error) throw error;
    return data as boolean;
  };

  it("held pass: untouched until release, then released and the assignment passed together; twice is a no-op", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    for (const q of await paper(attemptId)) await saveAnswer(student, attemptId, q.id, "b");
    await submitAttempt(attemptId);
    expect((await attemptRow(attemptId)).status).toBe("submitted");
    expect(await assignmentStatus(student, heldCurriculumId)).toBe("open");

    expect(await release(attemptId)).toBe(true);
    const released = await attemptRow(attemptId);
    expect(released.status).toBe("released");
    expect(released.released_at).not.toBeNull();
    expect(await assignmentStatus(student, heldCurriculumId)).toBe("passed");

    expect(await release(attemptId)).toBe(false);
    expect(await attemptRow(attemptId)).toEqual(released);
  });

  it("held fail: released but the assignment stays open", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    await submitAttempt(attemptId);
    expect(await release(attemptId)).toBe(true);
    expect((await attemptRow(attemptId)).passed).toBe(false);
    expect(await assignmentStatus(student, heldCurriculumId)).toBe("open");
  });

  it("an in-progress attempt cannot be released", async () => {
    const student = await makeStudent();
    await grant(student, heldSetId);
    const { attemptId } = await startAttempt(student, heldSetId);
    expect(await release(attemptId)).toBe(false);
    expect((await attemptRow(attemptId)).status).toBe("in_progress");
    expect(await assignmentStatus(student, heldCurriculumId)).toBe("open");
  });
});

describe("sweepExpired", () => {
  it("submits only in-progress attempts past their deadline", async () => {
    const late = await makeStudent();
    const onTime = await makeStudent();
    await grant(late, heldSetId);
    await grant(onTime, heldSetId);
    const expired = await startAttempt(late, heldSetId);
    const running = await startAttempt(onTime, heldSetId);
    await expire(expired.attemptId);

    const count = await sweepExpired();
    expect(count).toBeGreaterThanOrEqual(1);
    const lateRow = await attemptRow(expired.attemptId);
    expect(lateRow.status).toBe("submitted");
    expect(lateRow.points).toBe(0);
    expect((await attemptRow(running.attemptId)).status).toBe("in_progress");
    expect(await sweepExpired()).toBe(0);
  });
});

describe("AttemptError", () => {
  it("is exported for callers to map codes to messages", () => {
    expect(new AttemptError("no_grant").code).toBe("no_grant");
  });
});
