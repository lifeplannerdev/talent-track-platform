// Unit tests: giveExtraAttemptsAction authenticates as staff before anything else and passes the
// session's staff id, never a client value. Session and extra-attempts functions are fakes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  profile: { id: "11111111-1111-4111-8111-111111111111", role: "staff" as string, consent_at: null },
  signedIn: true,
  calls: [] as unknown[][],
}));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: fake.signedIn ? { id: fake.profile.id } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { ...fake.profile, username: "trainer", full_name: null, batch: null, track: null } }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/extra-attempts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/extra-attempts")>();
  return {
    ExtraAttemptsError: real.ExtraAttemptsError,
    giveExtraAttempts: async (...args: unknown[]) => {
      fake.calls.push(args);
      return { stillBlocked: false };
    },
  };
});

import { giveExtraAttemptsAction } from "./actions";

const STUDENT = "22222222-2222-4222-8222-222222222222";
const CURRICULUM = "33333333-3333-4333-8333-333333333333";
const input = { studentId: STUDENT, curriculumId: CURRICULUM, n: 2, allowRepeats: true };

beforeEach(() => {
  fake.calls = [];
  fake.signedIn = true;
  fake.profile.role = "staff";
});

describe("giveExtraAttemptsAction", () => {
  it("a student caller is redirected and nothing is given", async () => {
    fake.profile.role = "student";
    await expect(giveExtraAttemptsAction(input)).rejects.toThrow(/REDIRECT/);
    expect(fake.calls).toEqual([]);
  });

  it("an anonymous caller is redirected to login and nothing is given", async () => {
    fake.signedIn = false;
    await expect(giveExtraAttemptsAction(input)).rejects.toThrow("REDIRECT /login");
    expect(fake.calls).toEqual([]);
  });

  it("staff: gives with the session's staff id; bad ids give nothing", async () => {
    await expect(giveExtraAttemptsAction(input)).resolves.toEqual({ ok: true, stillBlocked: false });
    expect(fake.calls).toEqual([[fake.profile.id, STUDENT, CURRICULUM, 2, true]]);
    await expect(giveExtraAttemptsAction({ ...input, studentId: "nope" })).resolves.toEqual({ ok: false, error: "invalid_request" });
    expect(fake.calls).toHaveLength(1);
  });
});
