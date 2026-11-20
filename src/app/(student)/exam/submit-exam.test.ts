// Integration test (LOCAL stack): submitExam when scoring crashes after the attempt was closed.
// The attempt is submitted, so the student must go to the result page ("being calculated", which
// retries) instead of seeing "could not be submitted". record_score is forced to fail through an
// admin-client Proxy (same technique as src/lib/exam-start.test.ts).
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ studentId: "", poisoned: new Set<string>(), closeFails: new Set<string>() }));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireStudentWithConsent: async () => ({ id: state.studentId, role: "student", consent_at: "2026-11-01T10:00:00Z" }),
}));
vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/admin")>();
  return {
    createAdminClient: () => {
      const client = real.createAdminClient();
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "rpc") {
            return (fn: string, args: Record<string, unknown>) => {
              if (fn === "record_score" && state.poisoned.has(args.p_attempt_id as string))
                return Promise.resolve({ data: null, error: { message: "simulated crash" } });
              if (fn === "close_attempt" && state.closeFails.has(args.p_attempt_id as string))
                return Promise.resolve({ data: null, error: { message: "simulated close failure" } });
              return target.rpc(fn, args);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import { startAttempt } from "@/lib/attempts";
import { submitExam } from "./actions";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const run = randomUUID().slice(0, 8);
let curriculumId = "";
let userId = "";

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

beforeAll(async () => {
  const username = `se.${run}`;
  const { data, error } = await db.auth.admin.createUser({
    email: `${username}@students.test`,
    password: `test-${randomUUID()}`,
    email_confirm: true,
    app_metadata: { role: "student", username, full_name: "SE Student" },
  });
  if (error) throw error;
  userId = data.user.id;
  state.studentId = userId;
  const c = await must(db.from("curriculums").insert({ name: `SE ${run}`, max_attempts: 3 }).select("id").single());
  curriculumId = c.id;
  for (const n of [1, 2]) {
    const set = await must(
      db.from("exam_sets").insert({ curriculum_id: c.id, name: `SE set ${n}`, question_count: 1, time_limit_min: 10 }).select("id").single(),
    );
    await must(
      db
        .from("questions")
        .insert({
          exam_set_id: set.id,
          topic: "t",
          difficulty: "easy",
          stem_de: `Frage ${n}?`,
          stem_en: `Question ${n}?`,
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
  }
  await must(db.from("assignments").insert({ student_id: userId, curriculum_id: c.id, position: 1 }).select("id"));
});

afterAll(async () => {
  if (userId) await db.auth.admin.deleteUser(userId);
  if (curriculumId) await db.from("curriculums").delete().eq("id", curriculumId);
});

describe("submitExam", () => {
  it("goes to the result page when scoring fails after the attempt was submitted", async () => {
    const { attemptId } = await startAttempt(userId, curriculumId);
    state.poisoned.add(attemptId);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(submitExam(attemptId)).rejects.toThrow(`REDIRECT /results/${attemptId}`);

    const row = await must(db.from("attempts").select("status, points").eq("id", attemptId).single());
    expect(row).toEqual({ status: "submitted", points: null });
    // Logged with the attempt id only (no names, answers or scores).
    const lines = logged.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes(attemptId))).toBe(true);
    logged.mockRestore();

    // The next read heals it (the result page retries scoring).
    state.poisoned.delete(attemptId);
    await expect(submitExam(attemptId)).rejects.toThrow(`REDIRECT /results/${attemptId}`);
    expect((await must(db.from("attempts").select("status").eq("id", attemptId).single())).status).toBe("released");
  });

  it("still reports the error when the attempt could not be closed (nothing was submitted)", async () => {
    const { attemptId } = await startAttempt(userId, curriculumId);
    state.closeFails.add(attemptId);
    await expect(submitExam(attemptId)).rejects.toThrow(/simulated close failure|Could not submit/);
    expect((await must(db.from("attempts").select("status").eq("id", attemptId).single())).status).toBe("in_progress");
    state.closeFails.delete(attemptId);
  });
});
