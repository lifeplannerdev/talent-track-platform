import { describe, expect, it } from "vitest";
import { extraAttemptsMessage, extraAttemptsSuccess, parseExtraAttemptsCount } from "./messages";

describe("extraAttemptsMessage", () => {
  it("explains each refusal and what to do", () => {
    expect(extraAttemptsMessage({ ok: false, error: "already_passed" })).toBe(
      "Nothing was given: this student has already passed this curriculum.",
    );
    expect(extraAttemptsMessage({ ok: false, error: "not_assigned" })).toBe(
      "Nothing was given: this curriculum is no longer assigned to this student. Reload the page.",
    );
    expect(extraAttemptsMessage({ ok: false, error: "invalid_n" })).toBe("Give from 1 to 10 extra attempts.");
    expect(extraAttemptsMessage({ ok: false, error: "invalid_request" })).toBe(
      "Nothing was given: the student or curriculum was not found. Reload the page.",
    );
  });

  it("falls back to a generic message", () => {
    expect(extraAttemptsMessage({ ok: false, error: "failed" })).toBe("The extra attempts could not be given. Please try again.");
    expect(extraAttemptsMessage({ ok: false, error: "not_staff" })).toBe("The extra attempts could not be given. Please try again.");
  });
});

describe("extraAttemptsSuccess", () => {
  const base = { studentName: "Asha Nair", curriculumName: "Pflege Ausbildung", allowRepeats: false, wasBlocked: false };

  it("says how many attempts were given, to whom, for which curriculum", () => {
    expect(extraAttemptsSuccess({ ...base, n: 1 })).toBe("Gave Asha Nair 1 extra attempt for Pflege Ausbildung.");
    expect(extraAttemptsSuccess({ ...base, n: 3 })).toBe("Gave Asha Nair 3 extra attempts for Pflege Ausbildung.");
  });

  it("adds that the block is lifted and that exam sets may be repeated", () => {
    expect(extraAttemptsSuccess({ ...base, n: 2, wasBlocked: true, allowRepeats: true })).toBe(
      "Gave Asha Nair 2 extra attempts for Pflege Ausbildung. The block is lifted. Exam sets they already had may be given again.",
    );
  });

  it("says when the student is still blocked because they have used more attempts than they now have", () => {
    expect(extraAttemptsSuccess({ ...base, n: 1, wasBlocked: true, stillBlocked: true })).toBe(
      "Gave Asha Nair 1 extra attempt for Pflege Ausbildung. Still blocked: they have already used more attempts than they now have, so give more extra attempts to lift the block.",
    );
  });
});

describe("parseExtraAttemptsCount", () => {
  it("accepts a whole number from 1 to 10", () => {
    expect(parseExtraAttemptsCount("1")).toBe(1);
    expect(parseExtraAttemptsCount(" 10 ")).toBe(10);
  });

  it("refuses anything else", () => {
    for (const v of ["", "0", "11", "2.5", "-1", "abc", "1e1"]) expect(parseExtraAttemptsCount(v)).toBeNull();
  });
});
