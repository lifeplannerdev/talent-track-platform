// Unit tests for the local demo data script (scripts/demo-seed.mjs): it refuses any Supabase URL
// that is not the local stack, so it can never write demo users into a hosted project.
import { describe, expect, it } from "vitest";
import { assertLocalUrl } from "../../scripts/demo-seed.mjs";

describe("assertLocalUrl", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://localhost"])("accepts the local stack %s", (url) => {
    expect(() => assertLocalUrl(url)).not.toThrow();
  });

  it.each([
    undefined,
    "",
    "https://abcd.supabase.co",
    "https://127.0.0.1:54321",
    "http://127.0.0.1.example.com",
    "http://localhost.example.com",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => assertLocalUrl(url)).toThrow(/local/);
  });
});
