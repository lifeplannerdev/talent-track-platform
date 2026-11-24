// A trainer who posts an admin-only server action directly is redirected and nothing is written:
// the action's first line is requireAdmin(). Session and service-role clients are fakes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ role: "trainer", writes: [] as string[] }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

function recorder(): unknown {
  return new Proxy(() => {}, {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      fake.writes.push(String(prop));
      return recorder();
    },
    apply: () => recorder(),
  });
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      if (table !== "profiles") return recorder();
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: "u1", role: fake.role, username: "t", full_name: null, batch: null, track: null, consent_at: null, trainer_id: null, active: true },
            }),
          }),
        }),
      };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => recorder() }));

import { saveCurriculum } from "./curriculums/actions";
import { saveQuestion } from "./questions/actions";
import { deleteStudent } from "./students/actions";

const ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  fake.role = "trainer";
  fake.writes = [];
});

describe("admin-only actions", () => {
  it("deleteStudent redirects a trainer and touches nothing", async () => {
    await expect(deleteStudent(ID, { confirmUsername: "x" })).rejects.toThrow("REDIRECT /staff");
    expect(fake.writes).toEqual([]);
  });

  it("saveCurriculum redirects a trainer and writes nothing", async () => {
    await expect(saveCurriculum({ name: "New" })).rejects.toThrow("REDIRECT /staff");
    expect(fake.writes).toEqual([]);
  });

  it("saveQuestion redirects a trainer and writes nothing", async () => {
    await expect(
      saveQuestion({ examSetId: ID, status: "draft", fields: {} as never }),
    ).rejects.toThrow("REDIRECT /staff");
    expect(fake.writes).toEqual([]);
  });
});
