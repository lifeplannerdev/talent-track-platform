import { describe, expect, it } from "vitest";
import { consistentPassMark, topicTotals } from "./report";

describe("consistentPassMark", () => {
  it("returns the pass mark when it agrees with the stored outcome", () => {
    expect(consistentPassMark({ percent: 66.7, passed: true, passMarkPercent: 60 })).toBe(60);
    expect(consistentPassMark({ percent: 40, passed: false, passMarkPercent: 60 })).toBe(60);
    expect(consistentPassMark({ percent: 60, passed: true, passMarkPercent: 60 })).toBe(60);
  });
  it("hides a pass mark that contradicts the stored outcome (changed after scoring)", () => {
    expect(consistentPassMark({ percent: 65, passed: true, passMarkPercent: 70 })).toBeNull();
    expect(consistentPassMark({ percent: 65, passed: false, passMarkPercent: 60 })).toBeNull();
  });
  it("returns null when the pass mark is unknown", () => {
    expect(consistentPassMark({ percent: 50, passed: true, passMarkPercent: null })).toBeNull();
    expect(consistentPassMark({ percent: 50, passed: true, passMarkPercent: undefined })).toBeNull();
  });
});

describe("topicTotals", () => {
  it("adds scored questions up per topic, sorted by topic", () => {
    expect(
      topicTotals([
        { topic: "Recht", awardedPoints: 1, maxPoints: 1 },
        { topic: "Pflege", awardedPoints: 0, maxPoints: 2 },
        { topic: "Recht", awardedPoints: 0, maxPoints: 1 },
        { topic: "Pflege", awardedPoints: 2, maxPoints: 2 },
      ]),
    ).toEqual([
      { topic: "Pflege", points: 2, max: 4 },
      { topic: "Recht", points: 1, max: 2 },
    ]);
  });
  it("skips unscored questions and names a missing topic 'Other'", () => {
    expect(
      topicTotals([
        { topic: null, awardedPoints: 1, maxPoints: 1 },
        { topic: "Recht", awardedPoints: null, maxPoints: 1 },
      ]),
    ).toEqual([{ topic: "Other", points: 1, max: 1 }]);
  });
});
