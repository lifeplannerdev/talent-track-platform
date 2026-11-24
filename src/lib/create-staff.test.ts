// Unit tests for the one-off first-staff script (scripts/create-staff.ts): input checks and the
// exact Auth admin payload. Nothing here talks to a database. Passwords are TEST values.
import { describe, expect, it, vi } from "vitest";
import { createStaff, staffAccountFromEnv } from "../../scripts/create-staff";

const ENV = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  STAFF_EMAIL: "Trainer@Example.org",
  STAFF_USERNAME: "trainer.one",
  STAFF_FULL_NAME: "Trainer One",
  STAFF_PASSWORD: "test-long-password-1",
};

describe("staffAccountFromEnv", () => {
  it("builds a confirmed staff user with role, username and full name in app_metadata", () => {
    expect(staffAccountFromEnv(ENV)).toEqual({
      ok: true,
      url: ENV.SUPABASE_URL,
      serviceRoleKey: ENV.SUPABASE_SERVICE_ROLE_KEY,
      user: {
        email: "trainer@example.org",
        password: ENV.STAFF_PASSWORD,
        email_confirm: true,
        app_metadata: { role: "admin", username: "trainer.one", full_name: "Trainer One" },
      },
    });
  });

  it("lists every missing or invalid value, never echoing the password", () => {
    const result = staffAccountFromEnv({ ...ENV, STAFF_EMAIL: "nope", STAFF_USERNAME: "Bad Name", STAFF_PASSWORD: " short " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      "STAFF_EMAIL must be an email address",
      "STAFF_USERNAME may only contain a-z, 0-9, dot, dash and underscore",
      "STAFF_PASSWORD must not start or end with a space",
    ]);
    expect(JSON.stringify(result)).not.toContain("short");
    const missing = staffAccountFromEnv({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors).toContain("SUPABASE_SERVICE_ROLE_KEY is required");
  });

  it("STAFF_ROLE=trainer creates a trainer, admin is the default and an empty value means admin", () => {
    const trainer = staffAccountFromEnv({ ...ENV, STAFF_ROLE: "trainer" });
    expect(trainer.ok && trainer.user.app_metadata.role).toBe("trainer");
    const admin = staffAccountFromEnv({ ...ENV, STAFF_ROLE: "admin" });
    expect(admin.ok && admin.user.app_metadata.role).toBe("admin");
    const blank = staffAccountFromEnv({ ...ENV, STAFF_ROLE: "" });
    expect(blank.ok && blank.user.app_metadata.role).toBe("admin");
  });

  it.each(["staff", "student", "Trainer", "root"])("rejects STAFF_ROLE=%s without echoing the password", (role) => {
    const result = staffAccountFromEnv({ ...ENV, STAFF_ROLE: role });
    expect(result).toEqual({ ok: false, errors: ["STAFF_ROLE must be admin or trainer"] });
    expect(JSON.stringify(result)).not.toContain(ENV.STAFF_PASSWORD);
  });

  it("needs a password of at least 12 characters", () => {
    const result = staffAccountFromEnv({ ...ENV, STAFF_PASSWORD: "test-short" });
    expect(result).toMatchObject({ ok: false, errors: ["STAFF_PASSWORD must be at least 12 characters"] });
  });
});

describe("createStaff", () => {
  it("calls the Auth admin API once and logs neither the password nor the key", async () => {
    const createUser = vi.fn(async () => ({ data: { user: { id: "u-1" } }, error: null }));
    const log = vi.fn();
    const code = await createStaff(ENV, { createUser }, log);
    expect(code).toBe(0);
    expect(createUser).toHaveBeenCalledTimes(1);
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain("u-1");
    expect(output).not.toContain(ENV.STAFF_PASSWORD);
    expect(output).not.toContain(ENV.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("a trainer run sends role trainer and prints neither the password nor the key", async () => {
    const createUser = vi.fn(async (...args: unknown[]) => ({ data: { user: { id: String(args.length) + "-u-2" } }, error: null }));
    const log = vi.fn();
    expect(await createStaff({ ...ENV, STAFF_ROLE: "trainer" }, { createUser }, log)).toBe(0);
    expect(createUser.mock.calls[0]?.[0]).toMatchObject({ app_metadata: { role: "trainer" } });
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain("trainer account");
    expect(output).not.toContain(ENV.STAFF_PASSWORD);
    expect(output).not.toContain(ENV.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("returns 1 and reports the error code only when creation fails", async () => {
    const createUser = vi.fn(async () => ({ data: { user: null }, error: { message: "boom", code: "email_exists" } }));
    const log = vi.fn();
    expect(await createStaff(ENV, { createUser }, log)).toBe(1);
    expect(JSON.stringify(log.mock.calls)).toContain("email_exists");
  });
});
