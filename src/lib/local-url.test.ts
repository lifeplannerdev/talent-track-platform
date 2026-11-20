// The local-only guard shared by scripts/demo-seed.mjs and e2e/seed.ts: both write test users with
// the service role, so they must never run against a hosted Supabase project.
import { describe, expect, it } from "vitest";
import { assertLocalUrl } from "../../scripts/local-url.mjs";
import { assertLocalUrl as fromDemoSeed } from "../../scripts/demo-seed.mjs";

describe("assertLocalUrl (shared)", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://localhost", "http://127.0.0.1:54321/rest/v1"])(
    "accepts the local stack %s",
    (url) => expect(() => assertLocalUrl(url)).not.toThrow(),
  );

  it.each([
    "http://127.0.0.1.evil.com",
    "http://localhost.evil.com:54321",
    "https://127.0.0.1:54321",
    "https://abcd.supabase.co",
    "https://evil.com/localhost",
    "http://evil.com/127.0.0.1",
    "http://evil.com?host=localhost",
    "http://localhost@evil.com",
    "http://127.0.0.1@evil.com",
    "http://user@localhost:54321",
    "http://user:pass@127.0.0.1:54321",
    "http://[::1]:54321",
    "localhost:54321",
    "",
    undefined,
  ])("refuses %s", (url) => expect(() => assertLocalUrl(url)).toThrow(/local/));

  it("is the same check the demo seed uses", () => {
    expect(fromDemoSeed).toBe(assertLocalUrl);
  });
});
