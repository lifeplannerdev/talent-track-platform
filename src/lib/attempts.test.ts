// Integration tests for the attempt lifecycle. They run against the LOCAL Supabase stack
// (npm run db:start) with the service role, using throwaway users and curriculums that are
// removed again in afterAll. Deadlines are tested by moving deadline_at into the past.
// Spec change 1: two free attempts per curriculum, a different exam set each time (chosen by the
// server), marks released the moment the attempt is scored.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AttemptError,
  getAttemptForStudent,
  saveAnswer,
  StartError,
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

async function ok(p: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await p;
  if (error) throw error;
}

let curriculumCounter = 0;
async function makeCurriculum(maxAttempts = 2): Promise<string> {
  curriculumCounter += 1;
  const c = await must(
    db.from("curriculums").insert({ name: `T2 ${run} ${curriculumCounter}`, max_attempts: maxAttempts }).select("id").single(),
  );
  curriculumIds.push(c.id);
  return c.id as string;
}

/** An exam set of 3 questions per paper with `approved` approved questions (points 1, 2, 3, ...) and one draft. */
async function makeExamSet(curriculumId: string, approved = 6, name = "set"): Promise<string> {
  const set = await must(
    db
      .from("exam_sets")
      .insert({ curriculum_id: curriculumId, name: `T2 ${name}`, question_count: 3, time_limit_min: 20, pass_mark_percent: 60 })
      .select("id")
      .single(),
  );
  const rows = Array.from({ length: approved + 1 }, (_, i) => i + 1).map((n) => ({
    exam_set_id: set.id,
    topic: n % 2 ? "recht" : "alltag",
    difficulty: "easy",
    stem_de: `Frage ${n} (${name})`,
    stem_en: `Question ${n} (${name})`,
    options: OPTIONS,
    correct_option_id: "b",
    points: ((n - 1) % 3) + 1,
    status: n === approved + 1 ? "draft" : "approved",
  }));
  await ok(db.from("questions").insert(rows));
  return set.id as string;
}

let studentCounter = 0;
async function makeStudent(...curriculums: string[]): Promise<string> {
  studentCounter += 1;
  const username = `t2.${run}.${studentCounter}`;
  const { data, error } = await db.auth.admin.createUser({
    email: `${username}@students.test`,
    password: randomUUID(),
    email_confirm: true,
    app_metadata: { role: "student", username, full_name: `T2 Student ${studentCounter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  if (curriculums.length) {
    await ok(
      db
        .from("assignments")
        .insert(curriculums.map((c, i) => ({ student_id: data.user.id, curriculum_id: c, position: i + 1 }))),
    );
  }
  return data.user.id;
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

/** Starts an attempt in the curriculum, answers every question correctly (pass) or not at all (fail) and submits. */
async function take(studentId: string, curriculumId: string, pass: boolean) {
  const { attemptId } = await startAttempt(studentId, curriculumId);
  if (pass) for (const q of await paper(attemptId)) await saveAnswer(studentId, attemptId, q.id, "b");
  const result = await submitAttempt(attemptId);
  return { attemptId, result };
}

// Shared curriculum with three exam sets (two attempts allowed) for the lifecycle tests.
let main = "";
beforeAll(async () => {
  main = await makeCurriculum(2);
  await makeExamSet(main, 6, "main 1");
  await makeExamSet(main, 6, "main 2");
  await makeExamSet(main, 6, "main 3");
});

afterAll(async () => {
  // Deleting the users cascades profiles, attempts, attempt_questions, answers, assignments.
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  if (curriculumIds.length) await db.from("curriculums").delete().in("id", curriculumIds);
});

describe("startAttempt", () => {
  it("starts without any approval: stores the draw from an exam set of the curriculum and sets the deadline (database time)", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);

    const row = await attemptRow(attemptId);
    expect(row.status).toBe("in_progress");
    expect(new Date(row.deadline_at).getTime() - new Date(row.started_at).getTime()).toBe(20 * 60_000);
    const set = await must(db.from("exam_sets").select("curriculum_id").eq("id", row.exam_set_id).single());
    expect(set.curriculum_id).toBe(main);

    const questions = await paper(attemptId);
    expect(questions.map((q) => q.position)).toEqual([1, 2, 3]);
    for (const q of questions) expect([...q.option_order].sort()).toEqual(["a", "b", "c"]);
  });

  it("returns the existing in-progress attempt instead of starting a second one", async () => {
    const student = await makeStudent(main);
    const first = await startAttempt(student, main);
    const second = await startAttempt(student, main);
    expect(second.attemptId).toBe(first.attemptId);
    expect(await must(db.from("attempts").select("id").eq("student_id", student))).toHaveLength(1);
  });

  it("two attempts get two different exam sets; the third is refused with no_attempts_left", async () => {
    const student = await makeStudent(main);
    const first = await take(student, main, false);
    expect(await assignmentStatus(student, main)).toBe("open");
    const second = await take(student, main, false);
    const sets = [(await attemptRow(first.attemptId)).exam_set_id, (await attemptRow(second.attemptId)).exam_set_id];
    expect(new Set(sets).size).toBe(2);
    // The second failed attempt was the last one allowed: blocked in the same transaction.
    expect(await assignmentStatus(student, main)).toBe("blocked");
    await expect(startAttempt(student, main)).rejects.toMatchObject({ code: "blocked" });
    // Even if the assignment were open again without extra attempts, nothing is left.
    await ok(db.from("assignments").update({ status: "open" }).eq("student_id", student).eq("curriculum_id", main));
    await expect(startAttempt(student, main)).rejects.toMatchObject({ code: "no_attempts_left" });
    expect(await must(db.from("attempts").select("id").eq("student_id", student))).toHaveLength(2);
  });

  it("two simultaneous starts for one student and curriculum create exactly one attempt; the other gets in_progress", async () => {
    // Several students race at once, so a check-then-insert gap would show up.
    const students = await Promise.all(Array.from({ length: 6 }, () => makeStudent(main)));
    const outcomes = await Promise.all(
      students.map((st) => Promise.allSettled([startAttempt(st, main), startAttempt(st, main)])),
    );
    for (const [i, st] of students.entries()) {
      const attempts = await must(db.from("attempts").select("id").eq("student_id", st));
      expect(attempts).toHaveLength(1);
      for (const r of outcomes[i]) {
        if (r.status === "fulfilled") expect(r.value.attemptId).toBe(attempts[0].id);
        else {
          expect(r.reason).toBeInstanceOf(StartError);
          expect(r.reason).toMatchObject({ code: "in_progress" });
        }
      }
      expect(outcomes[i].some((r) => r.status === "fulfilled")).toBe(true);
    }
  });

  it("is 'unavailable' when every exam set of the curriculum was used, and allow_repeats reuses one (unseen questions first)", async () => {
    const single = await makeCurriculum(3);
    const setId = await makeExamSet(single, 6, "single");
    const student = await makeStudent(single);
    const first = await take(student, single, false);
    await expect(startAttempt(student, single)).rejects.toMatchObject({ code: "unavailable" });

    await ok(db.from("assignments").update({ allow_repeats: true }).eq("student_id", student).eq("curriculum_id", single));
    const second = await take(student, single, false);
    expect((await attemptRow(second.attemptId)).exam_set_id).toBe(setId);
    // 6 approved questions, 3 per paper: the repeat gets the 3 it has not seen.
    const seen = new Set((await paper(first.attemptId)).map((q) => q.question_id));
    for (const q of await paper(second.attemptId)) expect(seen.has(q.question_id)).toBe(false);

    // Third attempt: all 6 seen, so the paper is filled with seen questions.
    for (const q of await paper(second.attemptId)) seen.add(q.question_id);
    const third = await take(student, single, false);
    const thirdPaper = await paper(third.attemptId);
    expect(thirdPaper).toHaveLength(3);
    for (const q of thirdPaper) expect(seen.has(q.question_id)).toBe(true);
    expect(await assignmentStatus(student, single)).toBe("blocked");
  });

  it("with repeats allowed and every set used, picks the least recently used exam set", async () => {
    const two = await makeCurriculum(3);
    await makeExamSet(two, 9, "lru 1");
    await makeExamSet(two, 9, "lru 2");
    const student = await makeStudent(two);
    await ok(db.from("assignments").update({ allow_repeats: true }).eq("student_id", student).eq("curriculum_id", two));
    const a1 = await take(student, two, false);
    const a2 = await take(student, two, false);
    const a3 = await take(student, two, false);
    const [s1, s2, s3] = await Promise.all([a1, a2, a3].map(async (a) => (await attemptRow(a.attemptId)).exam_set_id));
    expect(s2).not.toBe(s1);
    expect(s3).toBe(s1);
  });

  it("is 'unavailable' when the curriculum has no exam set, or none with enough approved questions", async () => {
    const empty = await makeCurriculum();
    const short = await makeCurriculum();
    await makeExamSet(short, 2, "short");
    const student = await makeStudent(empty, short);
    await expect(startAttempt(student, empty)).rejects.toMatchObject({ code: "unavailable" });
    await expect(startAttempt(student, short)).rejects.toMatchObject({ code: "unavailable" });
    expect(await must(db.from("attempts").select("id").eq("student_id", student))).toHaveLength(0);
  });

  it("maps a passed, blocked or missing assignment to typed errors", async () => {
    const other = await makeCurriculum();
    await makeExamSet(other, 6, "other");
    const student = await makeStudent(main);
    await expect(startAttempt(student, other)).rejects.toMatchObject({ code: "not_open" });
    await expect(startAttempt(student, "not-a-uuid")).rejects.toMatchObject({ code: "not_open" });
    await ok(db.from("assignments").update({ status: "passed" }).eq("student_id", student).eq("curriculum_id", main));
    await expect(startAttempt(student, main)).rejects.toMatchObject({ code: "passed" });
    await ok(db.from("assignments").update({ status: "blocked" }).eq("student_id", student).eq("curriculum_id", main));
    await expect(startAttempt(student, main)).rejects.toMatchObject({ code: "blocked" });
  });

  it("finalises a submitted but unscored attempt (crash between close and score) before starting the next one", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    // Close without scoring, as an interrupted submit would leave it.
    await ok(db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: false }));
    expect((await attemptRow(attemptId)).status).toBe("submitted");

    const next = await startAttempt(student, main);
    expect(next.attemptId).not.toBe(attemptId);
    expect(await attemptRow(attemptId)).toMatchObject({ status: "released", points: 0, passed: false });
  });

  it("closes an expired attempt of the curriculum first and then starts the next one", async () => {
    const student = await makeStudent(main);
    const first = await startAttempt(student, main);
    await expire(first.attemptId);
    const next = await startAttempt(student, main);
    expect(next.attemptId).not.toBe(first.attemptId);
    expect((await attemptRow(first.attemptId)).status).toBe("released");
  });

  it("curriculums are independent: an attempt in progress in one does not stop a start in another", async () => {
    const other = await makeCurriculum();
    await makeExamSet(other, 6, "independent");
    const student = await makeStudent(main, other);
    const a = await startAttempt(student, main);
    const b = await startAttempt(student, other);
    expect(b.attemptId).not.toBe(a.attemptId);
  });
});

describe("resume", () => {
  it("returns the same questions, option order and deadline when an attempt is read again", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);

    const first = await getAttemptForStudent(student, attemptId);
    const resumed = await getAttemptForStudent(student, (await startAttempt(student, main)).attemptId);
    expect(first).not.toBeNull();
    expect(resumed!.deadlineAt).toBe(first!.deadlineAt);
    expect(resumed!.questions).toEqual(first!.questions);
    const stored = await paper(attemptId);
    expect(first!.questions.map((q) => q.options.map((o) => o.id))).toEqual(stored.map((q) => q.option_order));
    expect(JSON.stringify(first)).not.toMatch(/correct|"points"/);
    expect(first!.questions[0].stemDe).toMatch(/^Frage/);
    expect(Date.parse(first!.deadlineAt) - Date.parse(first!.startedAt)).toBe(20 * 60_000);
    expect(first!.reminderIntervalMin).toBe(15);
  });

  it("staff edits to count and duration apply to new attempts only; the paper and deadline are fixed at start", async () => {
    const c = await makeCurriculum();
    const s1 = await makeExamSet(c, 6, "edit 1");
    const s2 = await makeExamSet(c, 6, "edit 2");
    const student = await makeStudent(c);
    const first = await getAttemptForStudent(student, (await startAttempt(student, c)).attemptId);
    expect(first!.questions).toHaveLength(3);

    await ok(db.from("exam_sets").update({ question_count: 2, time_limit_min: 150, reminder_interval_min: 30 }).in("id", [s1, s2]));
    const resumed = await getAttemptForStudent(student, first!.id);
    expect(resumed!.questions).toHaveLength(3);
    expect(Date.parse(resumed!.deadlineAt) - Date.parse(resumed!.startedAt)).toBe(20 * 60_000);
    expect(resumed!.reminderIntervalMin).toBe(30);

    await submitAttempt(first!.id);
    const second = await getAttemptForStudent(student, (await startAttempt(student, c)).attemptId);
    expect(second!.id).not.toBe(first!.id);
    expect(second!.questions).toHaveLength(2);
    expect(Date.parse(second!.deadlineAt) - Date.parse(second!.startedAt)).toBe(150 * 60_000);
  });

  it("returns null for another student's attempt", async () => {
    const owner = await makeStudent(main);
    const other = await makeStudent(main);
    const { attemptId } = await startAttempt(owner, main);
    expect(await getAttemptForStudent(other, attemptId)).toBeNull();
  });

  it("reading an expired in-progress attempt submits and scores it (lazy expiry, marks at once)", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    await expire(attemptId);
    const view = await getAttemptForStudent(student, attemptId);
    expect(view!.status).toBe("released");
    expect((await attemptRow(attemptId)).points).toBe(0);
  });
});

describe("saveAnswer", () => {
  it("saves and overwrites the chosen option for the calling student's open attempt", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    const [q1] = await paper(attemptId);
    await saveAnswer(student, attemptId, q1.id, "a");
    await saveAnswer(student, attemptId, q1.id, "c");
    const rows = await must(db.from("answers").select("option_id").eq("attempt_question_id", q1.id));
    expect(rows).toEqual([{ option_id: "c" }]);
    const view = await getAttemptForStudent(student, attemptId);
    expect(view!.answers[q1.id]).toBe("c");
  });

  it("throws after the deadline and auto-submits the attempt", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    const [q1] = await paper(attemptId);
    await expire(attemptId);
    await expect(saveAnswer(student, attemptId, q1.id, "b")).rejects.toMatchObject({ code: "deadline_passed" });
    const rows = await must(db.from("answers").select("option_id").eq("attempt_question_id", q1.id));
    expect(rows).toHaveLength(0);
    expect((await attemptRow(attemptId)).status).toBe("released");
  });

  it("rejects an option id that does not belong to the question", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    const [q1] = await paper(attemptId);
    await expect(saveAnswer(student, attemptId, q1.id, "z")).rejects.toMatchObject({ code: "invalid_option" });
  });

  it("a student cannot save into another student's attempt", async () => {
    const owner = await makeStudent(main);
    const intruder = await makeStudent(main);
    const { attemptId } = await startAttempt(owner, main);
    const [q1] = await paper(attemptId);
    await expect(saveAnswer(intruder, attemptId, q1.id, "b")).rejects.toMatchObject({ code: "not_found" });
    const rows = await must(db.from("answers").select("option_id").eq("attempt_question_id", q1.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects saving after the attempt is submitted", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    const [q1] = await paper(attemptId);
    await submitAttempt(attemptId);
    await expect(saveAnswer(student, attemptId, q1.id, "b")).rejects.toMatchObject({ code: "closed" });
  });
});

describe("submitAttempt", () => {
  it("returns the scored result, released at once; submitting twice changes nothing", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    const questions = await paper(attemptId);
    await saveAnswer(student, attemptId, questions[0].id, "b");

    const result = await submitAttempt(attemptId);
    const once = await attemptRow(attemptId);
    const again = await submitAttempt(attemptId);
    const twice = await attemptRow(attemptId);

    const max = questions.reduce((s, q) => s + q.questions.points, 0);
    expect(result).toEqual({ status: "released", points: questions[0].questions.points, maxPoints: max, passed: false });
    expect(again).toEqual(result);
    expect(once.status).toBe("released");
    expect(once.released_at).not.toBeNull();
    expect(once.released_by).toBeNull();
    expect(twice).toEqual(once);
  });

  it("a pass marks the assignment passed; other curriculums are unchanged", async () => {
    const other = await makeCurriculum();
    await makeExamSet(other, 6, "pass other");
    const student = await makeStudent(main, other);
    const { result } = await take(student, main, true);
    expect(result).toMatchObject({ status: "released", passed: true });
    expect(await assignmentStatus(student, main)).toBe("passed");
    expect(await assignmentStatus(student, other)).toBe("open");
  });

  it("a failed first attempt is shown at once and leaves the assignment open", async () => {
    const student = await makeStudent(main);
    const { result } = await take(student, main, false);
    expect(result).toEqual({ status: "released", points: 0, maxPoints: expect.any(Number), passed: false });
    expect(await assignmentStatus(student, main)).toBe("open");
  });

  it("never scores an attempt with no attempt questions: it stays submitted (being calculated), with no points", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    // A paper that lost its questions (data damage): scoring it would record 0 of 0 as a pass.
    await ok(db.from("attempt_questions").delete().eq("attempt_id", attemptId));

    const result = await submitAttempt(attemptId);
    expect(result).toEqual({ status: "submitted", points: null, maxPoints: null, passed: null });
    await sweepExpired();
    expect(await attemptRow(attemptId)).toMatchObject({ status: "submitted", points: null, max_points: null, passed: null });
    expect(await assignmentStatus(student, main)).toBe("open");
  });

  it("a submit after the deadline scores only answers saved before the deadline", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
    const [q1, q2] = await paper(attemptId);
    await saveAnswer(student, attemptId, q1.id, "b");
    await expire(attemptId);
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

  it("scores against the pass mark snapshot taken at start, not a pass mark changed during the exam", async () => {
    const c = await makeCurriculum();
    const setId = await makeExamSet(c, 6, "snapshot");
    const student = await makeStudent(c);
    const { attemptId } = await startAttempt(student, c);
    expect((await attemptRow(attemptId)).pass_mark_percent).toBe(60);
    await ok(db.from("exam_sets").update({ pass_mark_percent: 0 }).eq("id", setId));
    await submitAttempt(attemptId);
    expect(await attemptRow(attemptId)).toMatchObject({ status: "released", points: 0, passed: false, pass_mark_percent: 60 });
  });

  it("scores with the answer key read at submit time and ignores later staff edits", async () => {
    const student = await makeStudent(main);
    const { attemptId } = await startAttempt(student, main);
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

describe("sweepExpired", () => {
  it("submits and scores only in-progress attempts past their deadline, and heals an unscored submit", async () => {
    const late = await makeStudent(main);
    const onTime = await makeStudent(main);
    const crashed = await makeStudent(main);
    const expired = await startAttempt(late, main);
    const running = await startAttempt(onTime, main);
    const interrupted = await startAttempt(crashed, main);
    await expire(expired.attemptId);
    await ok(db.rpc("close_attempt", { p_attempt_id: interrupted.attemptId, p_only_if_expired: false }));

    const count = await sweepExpired();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await attemptRow(expired.attemptId)).toMatchObject({ status: "released", points: 0, passed: false });
    expect(await attemptRow(interrupted.attemptId)).toMatchObject({ status: "released", points: 0 });
    expect((await attemptRow(running.attemptId)).status).toBe("in_progress");
    expect(await sweepExpired()).toBe(0);
  });
});

describe("errors", () => {
  it("AttemptError and StartError are exported for callers to map codes to messages", () => {
    expect(new AttemptError("closed").code).toBe("closed");
    expect(new StartError("unavailable").code).toBe("unavailable");
  });
});
