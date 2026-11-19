// Integration tests for the student's exam start cards and results list against the LOCAL
// Supabase stack. Student sessions are real (password sign-in with the anon key), so RLS and the
// student views decide what is visible. Fixtures are written with the service role.
// Passwords are TEST values generated per run.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

// record_score fails for these attempt ids, as a crash between close and score would leave them.
const poisoned = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/admin")>();
  return {
    createAdminClient: () => {
      const client = real.createAdminClient();
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "rpc") {
            return (fn: string, args: Record<string, unknown>) =>
              fn === "record_score" && poisoned.has(args.p_attempt_id as string)
                ? Promise.resolve({ data: null, error: { message: "simulated crash" } })
                : target.rpc(fn, args);
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import { saveAnswer, startAttempt, submitAttempt } from "./attempts";
import { getExamStartState } from "./exam-start";
import { listStudentResults } from "./results";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
const curriculumIds: string[] = [];
let curA = "";
let curB = "";
let curEmpty = "";
let setA1 = "";
let setB1 = "";

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

let counter = 0;
async function makeStudent(): Promise<{ id: string; client: SupabaseClient }> {
  counter += 1;
  const username = `es.${run}.${counter}`;
  const email = `${username}@students.test`;
  const password = `test-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "student", username, full_name: `ES ${counter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

async function assign(studentId: string, curriculumId: string, position: number, status = "open", extra = 0) {
  await must(
    db
      .from("assignments")
      .insert({ student_id: studentId, curriculum_id: curriculumId, position, status, extra_attempts: extra })
      .select("id"),
  );
}

async function attempt(studentId: string, examSetId: string, status: "submitted" | "released", points = 1) {
  const past = new Date(Date.now() - 3_600_000).toISOString();
  const row = await must(
    db
      .from("attempts")
      .insert({
        student_id: studentId,
        exam_set_id: examSetId,
        status,
        deadline_at: past,
        submitted_at: past,
        points: status === "released" ? points : null,
        max_points: status === "released" ? 2 : null,
        passed: status === "released" ? points >= 1 : null,
        released_at: status === "released" ? past : null,
      })
      .select("id")
      .single(),
  );
  return row.id as string;
}

/** Moves the attempt's deadline into the past, keeping its saved answers before the deadline. */
async function expireWithAnswers(attemptId: string) {
  const deadline = new Date(Date.now() - 60_000).toISOString();
  await must(
    db
      .from("attempts")
      .update({ started_at: new Date(Date.now() - 30 * 60_000).toISOString(), deadline_at: deadline })
      .eq("id", attemptId)
      .select("id"),
  );
  const paper = await must(db.from("attempt_questions").select("id").eq("attempt_id", attemptId));
  if (paper.length) {
    await db
      .from("answers")
      .update({ saved_at: new Date(Date.now() - 2 * 60_000).toISOString() })
      .in(
        "attempt_question_id",
        paper.map((q) => q.id),
      );
  }
}

async function makeSet(curriculumId: string, name: string, approved: number) {
  const set = await must(
    db
      .from("exam_sets")
      .insert({ curriculum_id: curriculumId, name, question_count: 1, time_limit_min: 10, pass_mark_percent: 50 })
      .select("id")
      .single(),
  );
  if (approved > 0) {
    await must(
      db
        .from("questions")
        .insert(
          Array.from({ length: approved }, (_, i) => ({
            exam_set_id: set.id,
            topic: "t",
            difficulty: "easy",
            stem_de: `Frage ${name} ${i}`,
            stem_en: `Question ${name} ${i}`,
            options: [
              { id: "a", de: "Ja", en: "Yes" },
              { id: "b", de: "Nein", en: "No" },
            ],
            correct_option_id: "b",
            status: "approved",
          })),
        )
        .select("id"),
    );
  }
  return set.id as string;
}

beforeAll(async () => {
  for (const name of [`ES A ${run}`, `ES B ${run}`, `ES Empty ${run}`]) {
    const c = await must(db.from("curriculums").insert({ name }).select("id").single());
    curriculumIds.push(c.id);
  }
  [curA, curB, curEmpty] = curriculumIds;
  setA1 = await makeSet(curA, "A1", 2);
  await makeSet(curA, "A2", 2);
  setB1 = await makeSet(curB, "B1", 2);
  await makeSet(curB, "B2", 2);
  // curEmpty has one exam set without approved questions: nothing can be given.
  await makeSet(curEmpty, "E1", 0);
});

afterAll(async () => {
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  for (const id of curriculumIds) await db.from("curriculums").delete().eq("id", id);
});

describe("getExamStartState", () => {
  it("is an empty list when nothing is assigned", async () => {
    const s = await makeStudent();
    session.client = s.client;
    expect(await getExamStartState(s.id)).toEqual([]);
  });

  it("a fresh student with two curriculums gets two ready cards with 2 attempts each, in position order", async () => {
    const s = await makeStudent();
    await assign(s.id, curB, 1);
    await assign(s.id, curA, 2);
    session.client = s.client;
    expect(await getExamStartState(s.id)).toEqual([
      { curriculumId: curB, name: `ES B ${run}`, position: 1, kind: "ready", attemptsLeft: 2 },
      { curriculumId: curA, name: `ES A ${run}`, position: 2, kind: "ready", attemptsLeft: 2 },
    ]);
  });

  it("curriculums are independent: one passed and one blocked", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1, "passed");
    await assign(s.id, curB, 2, "blocked");
    await attempt(s.id, setA1, "released", 2);
    await attempt(s.id, setB1, "released", 0);
    session.client = s.client;
    expect(await getExamStartState(s.id)).toMatchObject([
      { curriculumId: curA, kind: "passed", attemptsLeft: 1 },
      { curriculumId: curB, kind: "blocked", attemptsLeft: 1 },
    ]);
  });

  it("an open assignment with no attempts left shows as blocked; extra attempts count", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1);
    await assign(s.id, curB, 2, "open", 1);
    for (const set of [setA1, setA1]) await attempt(s.id, set, "released", 0);
    for (const set of [setB1, setB1]) await attempt(s.id, set, "released", 0);
    session.client = s.client;
    expect(await getExamStartState(s.id)).toMatchObject([
      { curriculumId: curA, kind: "blocked", attemptsLeft: 0 },
      // Two used of 2 + 1; B2 is unused, so the third attempt can be given.
      { curriculumId: curB, kind: "ready", attemptsLeft: 1 },
    ]);
  });

  it("in progress: the card carries the attempt id, the other curriculum stays ready", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1);
    await assign(s.id, curB, 2);
    const { attemptId } = await startAttempt(s.id, curA);
    session.client = s.client;
    expect(await getExamStartState(s.id)).toEqual([
      { curriculumId: curA, name: `ES A ${run}`, position: 1, kind: "in_progress", attemptsLeft: 2, attemptId },
      { curriculumId: curB, name: `ES B ${run}`, position: 2, kind: "ready", attemptsLeft: 2 },
    ]);
  });

  it("an unscored submitted attempt is scored on read; if scoring fails the card says calculating", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1);
    await assign(s.id, curB, 2);
    const healed = (await startAttempt(s.id, curA)).attemptId;
    await must(db.rpc("close_attempt", { p_attempt_id: healed, p_only_if_expired: false }));
    const stuck = (await startAttempt(s.id, curB)).attemptId;
    await must(db.rpc("close_attempt", { p_attempt_id: stuck, p_only_if_expired: false }));
    poisoned.add(stuck);
    session.client = s.client;
    try {
      expect(await getExamStartState(s.id)).toMatchObject([
        { curriculumId: curA, kind: "ready", attemptsLeft: 1 },
        { curriculumId: curB, kind: "calculating", attemptId: stuck },
      ]);
      expect(await must(db.from("attempts").select("status").eq("id", healed).single())).toEqual({ status: "released" });
    } finally {
      poisoned.delete(stuck);
    }
    // The next read heals it.
    expect(await getExamStartState(s.id)).toMatchObject([{ kind: "ready" }, { curriculumId: curB, kind: "ready", attemptsLeft: 1 }]);
  });

  it("an expired attempt with all answers correct heals to passed on read: the card is passed, not ready", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1);
    const { attemptId } = await startAttempt(s.id, curA);
    const paper = await must(db.from("attempt_questions").select("id").eq("attempt_id", attemptId));
    for (const q of paper) await saveAnswer(s.id, attemptId, q.id, "b");
    await expireWithAnswers(attemptId);
    session.client = s.client;
    expect(await getExamStartState(s.id)).toMatchObject([{ curriculumId: curA, kind: "passed" }]);
    expect(await must(db.from("attempts").select("status, passed").eq("id", attemptId).single())).toEqual({
      status: "released",
      passed: true,
    });
  });

  it("an expired attempt that heals to the last allowed fail shows blocked", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1);
    await attempt(s.id, setA1, "released", 0);
    const { attemptId } = await startAttempt(s.id, curA);
    await expireWithAnswers(attemptId);
    session.client = s.client;
    expect(await getExamStartState(s.id)).toMatchObject([{ curriculumId: curA, kind: "blocked", attemptsLeft: 0 }]);
    expect(await must(db.from("assignments").select("status").eq("student_id", s.id).single())).toEqual({ status: "blocked" });
  });

  it("unavailable: no exam set with enough questions, or every exam set used without allow_repeats", async () => {
    const s = await makeStudent();
    await assign(s.id, curEmpty, 1);
    await assign(s.id, curA, 2, "open", 1);
    await attempt(s.id, setA1, "released", 0);
    const a2 = (await startAttempt(s.id, curA)).attemptId;
    await submitAttempt(a2);
    session.client = s.client;
    expect(await getExamStartState(s.id)).toMatchObject([
      { curriculumId: curEmpty, kind: "unavailable", attemptsLeft: 2 },
      { curriculumId: curA, kind: "unavailable", attemptsLeft: 1 },
    ]);
    await must(db.from("assignments").update({ allow_repeats: true }).eq("student_id", s.id).eq("curriculum_id", curA).select("id"));
    expect((await getExamStartState(s.id))[1]).toMatchObject({ curriculumId: curA, kind: "ready", attemptsLeft: 1 });
  });

  it("only the session student's own assignments are read", async () => {
    const s = await makeStudent();
    const other = await makeStudent();
    await assign(other.id, curA, 1);
    session.client = s.client;
    expect(await getExamStartState(other.id)).toEqual([]);
  });
});

describe("listStudentResults", () => {
  it("lists the student's own scored attempts, newest first, with the numbers at once", async () => {
    const s = await makeStudent();
    const other = await makeStudent();
    await assign(s.id, curA, 1);
    await assign(s.id, curB, 2);
    const older = await attempt(s.id, setB1, "released", 2);
    const newer = await attempt(s.id, setA1, "released", 0);
    await attempt(other.id, setB1, "released", 2);
    await must(db.from("attempts").update({ submitted_at: new Date().toISOString() }).eq("id", newer).select("id"));
    session.client = s.client;

    expect(await listStudentResults(s.id)).toEqual([
      {
        id: newer,
        status: "released",
        curriculumId: curA,
        curriculumName: `ES A ${run}`,
        examSetName: "A1",
        submittedAt: expect.any(String),
        points: 0,
        maxPoints: 2,
        passed: false,
      },
      {
        id: older,
        status: "released",
        curriculumId: curB,
        curriculumName: `ES B ${run}`,
        examSetName: "B1",
        submittedAt: expect.any(String),
        points: 2,
        maxPoints: 2,
        passed: true,
      },
    ]);
  });

  it("a submitted attempt not scored yet is listed without numbers (being calculated)", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1);
    const pending = await attempt(s.id, setA1, "submitted");
    session.client = s.client;
    expect(await listStudentResults(s.id)).toEqual([
      expect.objectContaining({ id: pending, status: "submitted", points: null, maxPoints: null, passed: null }),
    ]);
  });

  it("returns nothing for an id that is not the session user's", async () => {
    const s = await makeStudent();
    session.client = s.client;
    expect(await listStudentResults("not-a-uuid")).toEqual([]);
  });
});
