// Integration tests for the student's exam start state and results list against the LOCAL
// Supabase stack. Student sessions are real (password sign-in with the anon key), so RLS and the
// student views decide what is visible. Fixtures are written with the service role.
// Passwords are TEST values generated per run.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

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
let setA1 = "";
let setA2 = "";
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

async function assign(studentId: string, curriculumId: string, position: number, status = "open") {
  await must(db.from("assignments").insert({ student_id: studentId, curriculum_id: curriculumId, position, status }).select("id"));
}

async function attempt(studentId: string, examSetId: string, status: "in_progress" | "submitted" | "released", points = 1) {
  const past = new Date(Date.now() - 3_600_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const row = await must(
    db
      .from("attempts")
      .insert({
        student_id: studentId,
        exam_set_id: examSetId,
        status,
        deadline_at: status === "in_progress" ? future : past,
        submitted_at: status === "in_progress" ? null : past,
        points: status === "in_progress" ? null : points,
        max_points: status === "in_progress" ? null : 2,
        passed: status === "in_progress" ? null : points >= 1,
        released_at: status === "released" ? past : null,
      })
      .select("id")
      .single(),
  );
  return row.id as string;
}

beforeAll(async () => {
  for (const name of [`ES A ${run}`, `ES B ${run}`]) {
    const c = await must(db.from("curriculums").insert({ name }).select("id").single());
    curriculumIds.push(c.id);
  }
  [curA, curB] = curriculumIds;
  const sets = await must(
    db
      .from("exam_sets")
      .insert([
        { curriculum_id: curA, name: "A1", question_count: 1, time_limit_min: 10, pass_mark_percent: 50, hold_result: true },
        { curriculum_id: curA, name: "A2", question_count: 1, time_limit_min: 10, pass_mark_percent: 50, hold_result: true },
        { curriculum_id: curB, name: "B1", question_count: 1, time_limit_min: 10, pass_mark_percent: 50, hold_result: false },
      ])
      .select("id, name"),
  );
  const byName = new Map(sets.map((s) => [s.name as string, s.id as string]));
  setA1 = byName.get("A1")!;
  setA2 = byName.get("A2")!;
  setB1 = byName.get("B1")!;
  // A2 must be created after A1 (sets are ordered by created_at).
  await must(db.from("exam_sets").update({ created_at: new Date(Date.now() + 1000).toISOString() }).eq("id", setA2).select("id"));
});

afterAll(async () => {
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  for (const id of curriculumIds) await db.from("curriculums").delete().eq("id", id);
});

describe("getExamStartState", () => {
  it("is 'none' only when nothing is assigned", async () => {
    const s = await makeStudent();
    session.client = s.client;
    expect(await getExamStartState(s.id)).toEqual({ kind: "none" });
  });

  it("is 'completed' when every curriculum is passed", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1, "passed");
    await assign(s.id, curB, 2, "passed");
    session.client = s.client;
    expect(await getExamStartState(s.id)).toEqual({ kind: "completed" });
  });

  it("is 'blocked' (contact your trainer) when nothing is open and a curriculum is blocked", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1, "blocked");
    await assign(s.id, curB, 2, "passed");
    session.client = s.client;
    expect(await getExamStartState(s.id)).toEqual({ kind: "blocked", curriculumNames: [`ES A ${run}`] });
  });

  it("a blocked curriculum lets the student go on to the next open one", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1, "blocked");
    await assign(s.id, curB, 2, "open");
    await must(db.from("attempt_grants").insert({ student_id: s.id, exam_set_id: setB1 }).select("id"));
    session.client = s.client;
    expect(await getExamStartState(s.id)).toMatchObject({ kind: "ready", examSet: { id: setB1, passMarkPercent: 50 } });
  });

  it("a grant on another exam set is not 'ready' while a result in the curriculum is held", async () => {
    const s = await makeStudent();
    await assign(s.id, curA, 1);
    const held = await attempt(s.id, setA1, "submitted");
    await must(db.from("attempt_grants").insert({ student_id: s.id, exam_set_id: setA2 }).select("id"));
    session.client = s.client;
    expect(await getExamStartState(s.id)).toMatchObject({ kind: "awaiting_review", attemptId: held, examSet: { id: setA1 } });
  });
});

describe("listStudentResults", () => {
  it("lists the student's own submitted and released attempts, newest first, numbers only when released", async () => {
    const s = await makeStudent();
    const other = await makeStudent();
    await assign(s.id, curA, 1);
    await assign(s.id, curB, 2);
    const released = await attempt(s.id, setB1, "released", 2);
    await new Promise((r) => setTimeout(r, 20));
    const held = await attempt(s.id, setA1, "submitted", 0);
    await attempt(s.id, setA2, "in_progress");
    await attempt(other.id, setB1, "released", 2);
    // Make the held attempt the newest submission.
    await must(db.from("attempts").update({ submitted_at: new Date().toISOString() }).eq("id", held).select("id"));
    session.client = s.client;

    const results = await listStudentResults(s.id);
    expect(results).toEqual([
      {
        id: held,
        status: "submitted",
        curriculumName: `ES A ${run}`,
        examSetName: "A1",
        submittedAt: expect.any(String),
        points: null,
        maxPoints: null,
        passed: null,
      },
      {
        id: released,
        status: "released",
        curriculumName: `ES B ${run}`,
        examSetName: "B1",
        submittedAt: expect.any(String),
        points: 2,
        maxPoints: 2,
        passed: true,
      },
    ]);
  });

  it("returns nothing for an id that is not the session user's", async () => {
    const s = await makeStudent();
    session.client = s.client;
    expect(await listStudentResults("not-a-uuid")).toEqual([]);
  });
});
