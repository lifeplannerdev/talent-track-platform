import { describe, expect, it } from "vitest";
import { ATTEMPT_FILTERS, attemptFilterQuery, attemptStatusKind, ATTEMPT_STATUS } from "./attempt-status";

describe("attemptStatusKind", () => {
  it("is in progress while the exam runs", () => {
    expect(attemptStatusKind({ status: "in_progress", points: null, maxPoints: null, passed: null })).toBe("in_progress");
  });

  it("is being scored when submitted without a score (or released without one)", () => {
    expect(attemptStatusKind({ status: "submitted", points: null, maxPoints: null, passed: null })).toBe("scoring");
    expect(attemptStatusKind({ status: "released", points: null, maxPoints: 5, passed: null })).toBe("scoring");
  });

  it("is passed or not passed once scored", () => {
    expect(attemptStatusKind({ status: "released", points: 9, maxPoints: 10, passed: true })).toBe("passed");
    expect(attemptStatusKind({ status: "released", points: 3, maxPoints: 10, passed: false })).toBe("not_passed");
  });
});

describe("ATTEMPT_STATUS", () => {
  it("labels every kind without hold or release wording", () => {
    expect(ATTEMPT_STATUS).toEqual({
      in_progress: { label: "In progress", variant: "outline" },
      scoring: { label: "Being scored", variant: "warning" },
      passed: { label: "Passed", variant: "success" },
      not_passed: { label: "Not passed", variant: "destructive" },
    });
    for (const f of ATTEMPT_FILTERS) expect(f.label).not.toMatch(/releas|held|hold|awaiting/i);
  });
});

describe("attemptFilterQuery", () => {
  it("maps each filter to attempt statuses and an outcome", () => {
    expect(attemptFilterQuery("")).toEqual({ statuses: ["in_progress", "submitted", "released"] });
    expect(attemptFilterQuery("in_progress")).toEqual({ statuses: ["in_progress"] });
    expect(attemptFilterQuery("scoring")).toEqual({ statuses: ["submitted"] });
    expect(attemptFilterQuery("passed")).toEqual({ statuses: ["released"], passed: true });
    expect(attemptFilterQuery("not_passed")).toEqual({ statuses: ["released"], passed: false });
  });

  it("treats an unknown or old value (submitted, released) as all attempts", () => {
    expect(attemptFilterQuery("released")).toEqual({ statuses: ["in_progress", "submitted", "released"] });
    expect(attemptFilterQuery("bogus")).toEqual({ statuses: ["in_progress", "submitted", "released"] });
  });

  it("offers every filter once, all attempts first", () => {
    expect(ATTEMPT_FILTERS.map((f) => f.value)).toEqual(["", "in_progress", "scoring", "passed", "not_passed"]);
  });
});
