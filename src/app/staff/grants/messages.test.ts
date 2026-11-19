import { describe, expect, it } from "vitest";
import { extraAttemptsMessage } from "./messages";

describe("extraAttemptsMessage", () => {
  it("explains each refusal", () => {
    expect(extraAttemptsMessage({ ok: false, error: "already_passed" })).toMatch(/already passed/i);
    expect(extraAttemptsMessage({ ok: false, error: "not_assigned" })).toMatch(/not assigned/i);
    expect(extraAttemptsMessage({ ok: false, error: "invalid_n" })).toBe("Give from 1 to 10 extra attempts.");
  });

  it("falls back to a generic message", () => {
    expect(extraAttemptsMessage({ ok: false, error: "failed" })).toBe("The extra attempts could not be given. Please try again.");
    expect(extraAttemptsMessage({ ok: false, error: "not_staff" })).toBe("The extra attempts could not be given. Please try again.");
  });
});
