// Unit tests for the role guards. The Supabase session client is a fake; redirect() throws.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  signedIn: true,
  profile: null as null | Record<string, unknown>,
}));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: fake.signedIn ? { id: "u1" } : null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: fake.profile }) }) }),
    }),
  }),
}));

import { isStaffRole, requireAdmin, requireRole, requireStudentWithConsent } from "./require-role";

function as(role: string, extra: Record<string, unknown> = {}) {
  fake.profile = {
    id: "u1", role, username: "x", full_name: null, batch: null, track: null,
    consent_at: "2026-01-01", trainer_id: null, active: true, ...extra,
  };
}

beforeEach(() => {
  fake.signedIn = true;
  fake.profile = null;
});

describe("isStaffRole", () => {
  it("is true for admin and trainer only", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("trainer")).toBe(true);
    expect(isStaffRole("student")).toBe(false);
  });
});

describe("requireRole", () => {
  it("staff accepts an admin and a trainer", async () => {
    as("admin");
    await expect(requireRole("staff")).resolves.toMatchObject({ role: "admin" });
    as("trainer");
    await expect(requireRole("staff")).resolves.toMatchObject({ role: "trainer" });
  });

  it("staff redirects a student to /exam/start", async () => {
    as("student");
    await expect(requireRole("staff")).rejects.toThrow("REDIRECT /exam/start");
  });

  it("student redirects both staff roles to /staff", async () => {
    as("admin");
    await expect(requireRole("student")).rejects.toThrow("REDIRECT /staff");
    as("trainer");
    await expect(requireRole("student")).rejects.toThrow("REDIRECT /staff");
  });

  it("an exact role must match exactly", async () => {
    as("trainer");
    await expect(requireRole("admin")).rejects.toThrow("REDIRECT /staff");
    as("admin");
    await expect(requireRole("admin")).resolves.toMatchObject({ role: "admin" });
  });

  it("an inactive profile is redirected to /login", async () => {
    as("trainer", { active: false });
    await expect(requireRole("staff")).rejects.toThrow("REDIRECT /login");
  });

  it("signed out or without a profile goes to /login", async () => {
    fake.signedIn = false;
    await expect(requireRole("staff")).rejects.toThrow("REDIRECT /login");
    fake.signedIn = true;
    fake.profile = null;
    await expect(requireRole("staff")).rejects.toThrow("REDIRECT /login");
  });
});

describe("requireAdmin", () => {
  it("passes an admin and sends a trainer to /staff", async () => {
    as("admin");
    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
    as("trainer");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /staff");
  });

  it("sends a student to /exam/start", async () => {
    as("student");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /exam/start");
  });
});

describe("requireStudentWithConsent", () => {
  it("still redirects a trainer to /staff and a student without consent to /consent", async () => {
    as("trainer");
    await expect(requireStudentWithConsent()).rejects.toThrow("REDIRECT /staff");
    as("student", { consent_at: null });
    await expect(requireStudentWithConsent()).rejects.toThrow("REDIRECT /consent");
  });
});
