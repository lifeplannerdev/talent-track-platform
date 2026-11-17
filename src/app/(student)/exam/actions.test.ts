// Unit tests: the exam server actions refuse a student who has not consented yet (security
// review S3). The proxy sends such students to /consent, but server actions can be called
// directly, so each action checks consent itself. Session and attempt functions are fakes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  profile: { id: "11111111-1111-4111-8111-111111111111", role: "student", consent_at: null as string | null },
  calls: [] as string[],
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
    return { kind: "ready", examSet: { id: "22222222-2222-4222-8222-222222222222" } };
  },
}));
vi.mock("@/lib/attempts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/attempts")>();
  return {
    AttemptError: real.AttemptError,
    isUuid: real.isUuid,
    startAttempt: async () => {
      fake.calls.push("startAttempt");
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
const QUESTION = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  fake.calls = [];
  fake.profile.consent_at = null;
});

describe("without consent", () => {
  it("startExam goes to /consent and starts nothing", async () => {
    await expect(startExam()).rejects.toThrow("REDIRECT /consent");
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

  it("the actions run as before", async () => {
    await expect(startExam()).rejects.toThrow(`REDIRECT /exam/${ATTEMPT}`);
    await expect(saveAnswerAction(ATTEMPT, QUESTION, "a")).resolves.toEqual({ ok: true });
    await expect(submitExam(ATTEMPT)).rejects.toThrow(`REDIRECT /results/${ATTEMPT}`);
    expect(fake.calls).toEqual(["getExamStartState", "startAttempt", "saveAnswer", "getAttemptStatus", "submitAttempt"]);
  });
});
