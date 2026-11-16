// Unit tests for the login and logout actions with a fake Supabase auth client: the session
// rules must hold even when the Auth server fails part-way (review finding, task 9).
// The password here is a TEST value.
import { beforeEach, describe, expect, it, vi } from "vitest";

type SignOutArgs = { scope?: "global" | "local" | "others" } | undefined;

const fake = vi.hoisted(() => ({
  signOutCalls: [] as SignOutArgs[],
  signOutErrors: {} as Partial<Record<"global" | "local" | "others", { message: string }>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signOut: async (args?: SignOutArgs) => {
        fake.signOutCalls.push(args);
        const scope = args?.scope ?? "global";
        return { error: fake.signOutErrors[scope] ?? null };
      },
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { role: "student", consent_at: null } }) }) }),
    }),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

import { login, logout } from "./actions";

function form(identifier: string, password: string) {
  const data = new FormData();
  data.set("identifier", identifier);
  data.set("password", password);
  return data;
}

beforeEach(() => {
  fake.signOutCalls = [];
  fake.signOutErrors = {};
});

describe("login", () => {
  it("ends the other sessions and goes to the role's home", async () => {
    await expect(login({ error: null }, form("anna.k", "test-pass-anna"))).rejects.toThrow("REDIRECT /consent");
    expect(fake.signOutCalls).toEqual([{ scope: "others" }]);
  });

  it("does not complete when the other sessions could not be ended", async () => {
    fake.signOutErrors.others = { message: "network" };
    const result = await login({ error: null }, form("anna.k", "test-pass-anna"));
    expect(result.error).toMatch(/could not sign you in/i);
    // The new session is dropped locally too, so nothing stays signed in half-way.
    expect(fake.signOutCalls).toEqual([{ scope: "others" }, { scope: "local" }]);
  });
});

describe("logout", () => {
  it("signs out everywhere and goes to login", async () => {
    await expect(logout()).rejects.toThrow("REDIRECT /login");
    expect(fake.signOutCalls).toEqual([undefined]);
  });

  it("still clears the browser session when the Auth server cannot be reached", async () => {
    fake.signOutErrors.global = { message: "network" };
    await expect(logout()).rejects.toThrow("REDIRECT /login");
    expect(fake.signOutCalls).toEqual([undefined, { scope: "local" }]);
  });
});
