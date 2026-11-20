// Integration tests for giving extra attempts (spec change 1) against the LOCAL Supabase stack,
// with the service role and throwaway users and curriculums removed again in afterAll.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Reads after the give_extra_attempts call fail while this is set (the rpc itself still runs).
const readFailure = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/admin")>();
  const failing = (): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop) =>
        prop === "then"
          ? (resolve: (v: unknown) => void) => resolve({ data: null, count: null, error: { message: "simulated read failure" } })
          : () => failing(),
      apply: () => failing(),
    });
  return {
    createAdminClient: () => {
      const client = real.createAdminClient();
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "from" && readFailure.on) return () => failing();
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import { startAttempt, submitAttempt } from "./attempts";
import { ExtraAttemptsError, giveExtraAttempts } from "./extra-attempts";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
let curriculumId = "";
let staffId = "";

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

let counter = 0;
async function makeUser(role: "student" | "staff"): Promise<string> {
  counter += 1;
  const username = `xa.${run}.${counter}`;
  const { data, error } = await db.auth.admin.createUser({
    email: `${username}@students.test`,
    password: randomUUID(),
    email_confirm: true,
    app_metadata: { role, username, full_name: `XA ${counter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  return data.user.id;
}

async function makeStudent(): Promise<string> {
  const id = await makeUser("student");
  await must(db.from("assignments").insert({ student_id: id, curriculum_id: curriculumId, position: 1 }).select("id"));
  return id;
}

async function assignment(studentId: string) {
  return must(
    db
      .from("assignments")
      .select("status, extra_attempts, allow_repeats")
      .eq("student_id", studentId)
      .eq("curriculum_id", curriculumId)
      .single(),
  );
}

beforeAll(async () => {
  const c = await must(db.from("curriculums").insert({ name: `XA ${run}`, max_attempts: 1 }).select("id").single());
  curriculumId = c.id;
  for (const name of ["XA 1", "XA 2"]) {
    const set = await must(
      db
        .from("exam_sets")
        .insert({ curriculum_id: curriculumId, name, question_count: 1, time_limit_min: 10, pass_mark_percent: 50 })
        .select("id")
        .single(),
    );
    await must(
      db
        .from("questions")
        .insert(
          [1, 2].map((n) => ({
            exam_set_id: set.id,
            topic: "t",
            difficulty: "easy",
            stem_de: `Frage ${n}`,
            stem_en: `Question ${n}`,
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
  staffId = await makeUser("staff");
});

afterAll(async () => {
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  if (curriculumId) await db.from("curriculums").delete().eq("id", curriculumId);
});

describe("giveExtraAttempts", () => {
  it("unblocks a blocked student, who can then start a new attempt", async () => {
    const student = await makeStudent();
    const { attemptId } = await startAttempt(student, curriculumId);
    await submitAttempt(attemptId);
    expect(await assignment(student)).toMatchObject({ status: "blocked" });

    await expect(giveExtraAttempts(staffId, student, curriculumId, 1, false)).resolves.toEqual({ stillBlocked: false });
    expect(await assignment(student)).toEqual({ status: "open", extra_attempts: 1, allow_repeats: false });
    const next = await startAttempt(student, curriculumId);
    expect(next.attemptId).not.toBe(attemptId);
  });

  it("keeps a student blocked who has used more attempts than the new allowance, and says so", async () => {
    const student = await makeStudent();
    // Two failed attempts used under an earlier, larger limit; the limit is now 1 (blocked).
    const sets = await must(db.from("exam_sets").select("id").eq("curriculum_id", curriculumId).order("name"));
    const past = new Date(Date.now() - 3_600_000).toISOString();
    for (const s of sets) {
      await must(
        db
          .from("attempts")
          .insert({ student_id: student, exam_set_id: s.id, status: "released", deadline_at: past, submitted_at: past, points: 0, max_points: 1, passed: false, released_at: past })
          .select("id"),
      );
    }
    await must(db.from("assignments").update({ status: "blocked" }).eq("student_id", student).eq("curriculum_id", curriculumId).select("id"));

    // 1 + 1 = 2 does not exceed 2 used.
    await expect(giveExtraAttempts(staffId, student, curriculumId, 1, false)).resolves.toEqual({ stillBlocked: true });
    expect(await assignment(student)).toMatchObject({ status: "blocked", extra_attempts: 1 });
    // 1 + 2 = 3 exceeds 2 used.
    await expect(giveExtraAttempts(staffId, student, curriculumId, 1, false)).resolves.toEqual({ stillBlocked: false });
    expect(await assignment(student)).toMatchObject({ status: "open", extra_attempts: 2 });
  });

  it("reports still blocked from the attempts used, also when the stored status is open after the limit was lowered", async () => {
    const student = await makeStudent();
    // Two failed attempts used; the limit is 1 now, but the stored status stayed 'open'.
    const sets = await must(db.from("exam_sets").select("id").eq("curriculum_id", curriculumId).order("name"));
    const past = new Date(Date.now() - 3_600_000).toISOString();
    for (const s of sets) {
      await must(
        db
          .from("attempts")
          .insert({ student_id: student, exam_set_id: s.id, status: "released", deadline_at: past, submitted_at: past, points: 0, max_points: 1, passed: false, released_at: past })
          .select("id"),
      );
    }
    expect(await assignment(student)).toMatchObject({ status: "open" });

    // 1 + 1 = 2 does not exceed 2 used: still blocked in effect.
    await expect(giveExtraAttempts(staffId, student, curriculumId, 1, false)).resolves.toEqual({ stillBlocked: true });
    // 1 + 2 = 3 exceeds 2 used: free to start.
    await expect(giveExtraAttempts(staffId, student, curriculumId, 1, false)).resolves.toEqual({ stillBlocked: false });
  });

  it("a failing read after the grant still reports success (the grant committed), with the status unknown", async () => {
    const student = await makeStudent();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // The rpc runs on the real client; only the reads that follow fail.
    readFailure.on = true;
    try {
      await expect(giveExtraAttempts(staffId, student, curriculumId, 1, false)).resolves.toEqual({ stillBlocked: null });
    } finally {
      readFailure.on = false;
      logged.mockRestore();
    }
    expect(await assignment(student)).toMatchObject({ extra_attempts: 1 });
  });

  it("adds up and can switch allow_repeats on (never off), at any time", async () => {
    const student = await makeStudent();
    await giveExtraAttempts(staffId, student, curriculumId, 2, true);
    await giveExtraAttempts(staffId, student, curriculumId, 3, false);
    expect(await assignment(student)).toEqual({ status: "open", extra_attempts: 5, allow_repeats: true });
  });

  it("validates n (1..10, whole numbers) and the ids before touching the database", async () => {
    const student = await makeStudent();
    for (const n of [0, 11, 1.5, Number.NaN]) {
      await expect(giveExtraAttempts(staffId, student, curriculumId, n, false)).rejects.toMatchObject({ code: "invalid_n" });
    }
    await expect(giveExtraAttempts(staffId, "nope", curriculumId, 1, false)).rejects.toMatchObject({ code: "not_assigned" });
    expect(await assignment(student)).toMatchObject({ extra_attempts: 0 });
  });

  it("refuses a non-staff giver, a curriculum that is not assigned and a passed curriculum", async () => {
    const student = await makeStudent();
    const other = await makeUser("student");
    await expect(giveExtraAttempts(student, student, curriculumId, 1, false)).rejects.toBeInstanceOf(ExtraAttemptsError);
    await expect(giveExtraAttempts(student, student, curriculumId, 1, false)).rejects.toMatchObject({ code: "not_staff" });
    await expect(giveExtraAttempts(staffId, other, curriculumId, 1, false)).rejects.toMatchObject({ code: "not_assigned" });
    await must(db.from("assignments").update({ status: "passed" }).eq("student_id", student).eq("curriculum_id", curriculumId).select("id"));
    await expect(giveExtraAttempts(staffId, student, curriculumId, 1, false)).rejects.toMatchObject({ code: "already_passed" });
    expect(await assignment(student)).toMatchObject({ status: "passed", extra_attempts: 0 });
  });
});
