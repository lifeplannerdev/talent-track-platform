// Unit tests: the exam server actions refuse a student who has not consented yet (security
// review S3). The proxy sends such students to /consent, but server actions can be called
// directly, so each action checks consent itself. Session and attempt functions are fakes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  profile: { id: "11111111-1111-4111-8111-111111111111", role: "student", consent_at: null as string | null, active: true },
  calls: [] as string[],
  startError: null as string | null,
}));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: fake.profile.id } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { ...fake.profile, username: "anna", full_name: null, batch: null, track: null } }) }) }),
    }),
  }),
}));
vi.mock("@/lib/exam-start", () => ({
  getExamStartState: async () => {
    fake.calls.push("getExamStartState");
    return [
      {
        curriculumId: "22222222-2222-4222-8222-222222222222",
        name: "Pflege",
        position: 1,
        kind: "in_progress",
        attemptsLeft: 2,
        attemptId: "55555555-5555-4555-8555-555555555555",
      },
    ];
  },
}));
vi.mock("@/lib/attempts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/attempts")>();
  return {
    AttemptError: real.AttemptError,
    StartError: real.StartError,
    isUuid: real.isUuid,
    startAttempt: async (_studentId: string, curriculumId: string) => {
      fake.calls.push(`startAttempt:${curriculumId}`);
      if (fake.startError) throw new real.StartError(fake.startError as never);
      return { attemptId: "33333333-3333-4333-8333-333333333333" };
    },
    saveAnswer: async () => {
      fake.calls.push("saveAnswer");
    },
    getAttemptStatus: async () => {
      fake.calls.push("getAttemptStatus");
      return "in_progress";
    },
    submitAttempt: async () => {
      fake.calls.push("submitAttempt");
    },
  };
});

import { saveAnswerAction, startExam, submitExam } from "./actions";

const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const CURRICULUM = "22222222-2222-4222-8222-222222222222";
const QUESTION = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  fake.calls = [];
  fake.startError = null;
  fake.profile.consent_at = null;
});

describe("without consent", () => {
  it("startExam goes to /consent and starts nothing", async () => {
    await expect(startExam(CURRICULUM)).rejects.toThrow("REDIRECT /consent");
    expect(fake.calls).toEqual([]);
  });

  it("saveAnswerAction goes to /consent and saves nothing", async () => {
    await expect(saveAnswerAction(ATTEMPT, QUESTION, "a")).rejects.toThrow("REDIRECT /consent");
    expect(fake.calls).toEqual([]);
  });

  it("submitExam goes to /consent and submits nothing", async () => {
    await expect(submitExam(ATTEMPT)).rejects.toThrow("REDIRECT /consent");
    expect(fake.calls).toEqual([]);
  });
});

describe("with consent", () => {
  beforeEach(() => {
    fake.profile.consent_at = "2026-11-01T10:00:00Z";
  });

  it("the actions run: start in the chosen curriculum, save, submit straight to the result", async () => {
    await expect(startExam(CURRICULUM)).rejects.toThrow(`REDIRECT /exam/${ATTEMPT}`);
    await expect(saveAnswerAction(ATTEMPT, QUESTION, "a")).resolves.toEqual({ ok: true });
    await expect(submitExam(ATTEMPT)).rejects.toThrow(`REDIRECT /results/${ATTEMPT}`);
    expect(fake.calls).toEqual([`startAttempt:${CURRICULUM}`, "saveAnswer", "getAttemptStatus", "submitAttempt"]);
  });

  it("a refused start goes back to the start page with the reason", async () => {
    fake.startError = "no_attempts_left";
    await expect(startExam(CURRICULUM)).rejects.toThrow("REDIRECT /exam/start?error=no_attempts_left");
    fake.startError = "unavailable";
    await expect(startExam(CURRICULUM)).rejects.toThrow("REDIRECT /exam/start?error=unavailable");
  });

  it("a start that lost a race goes to the attempt in progress", async () => {
    fake.startError = "in_progress";
    await expect(startExam(CURRICULUM)).rejects.toThrow("REDIRECT /exam/55555555-5555-4555-8555-555555555555");
  });

  it("a curriculum id that is not a uuid starts nothing", async () => {
    await expect(startExam("nope")).rejects.toThrow("REDIRECT /exam/start?error=not_open");
    expect(fake.calls).toEqual([]);
  });
});
