import { describe, expect, it } from "vitest";
import { canFillPaper, chooseExamSet } from "./exam-set-choice";

describe("canFillPaper", () => {
  it("needs at least question_count approved questions", () => {
    expect(canFillPaper({ questionCount: 3, topicMix: null }, ["a", "b", "a"])).toBe(true);
    expect(canFillPaper({ questionCount: 3, topicMix: {} }, ["a", "b"])).toBe(false);
    expect(canFillPaper({ questionCount: 1, topicMix: null }, [])).toBe(false);
  });

  it("with a topic mix, enough approved questions of every topic", () => {
    expect(canFillPaper({ questionCount: 3, topicMix: { a: 2, b: 1 } }, ["a", "a", "b"])).toBe(true);
    expect(canFillPaper({ questionCount: 3, topicMix: { a: 2, b: 1 } }, ["a", "b", "b", "b"])).toBe(false);
  });
});

const sets = [
  { id: "s1", lastUsedAt: "2026-11-01T10:00:00Z" },
  { id: "s2", lastUsedAt: null },
  { id: "s3", lastUsedAt: "2026-11-03T10:00:00Z" },
  { id: "s4", lastUsedAt: null },
];

describe("chooseExamSet", () => {
  it("picks at random among the unused sets, using the injected random number", () => {
    const used = new Set(["s1", "s3"]);
    expect(chooseExamSet(sets, used, false, () => 0)).toBe("s2");
    expect(chooseExamSet(sets, used, false, () => 0.99)).toBe("s4");
    expect(chooseExamSet(sets, used, true, () => 0.6)).toBe("s4");
  });

  it("can pick any unused set and never a used one", () => {
    const used = new Set(["s2"]);
    const picked = new Set<string>();
    for (let i = 0; i < 30; i++) picked.add(chooseExamSet(sets, used, false, () => i / 30)!);
    expect([...picked].sort()).toEqual(["s1", "s3", "s4"]);
  });

  it("returns null when every set is used and repeats are not allowed", () => {
    expect(chooseExamSet(sets, new Set(["s1", "s2", "s3", "s4"]), false, () => 0)).toBeNull();
  });

  it("with repeats allowed and every set used, picks the least recently used (never used counts as oldest)", () => {
    const all = new Set(["s1", "s2", "s3", "s4"]);
    const used = [
      { id: "s1", lastUsedAt: "2026-11-02T10:00:00Z" },
      { id: "s2", lastUsedAt: "2026-11-01T10:00:00Z" },
      { id: "s3", lastUsedAt: "2026-11-03T10:00:00Z" },
    ];
    expect(chooseExamSet(used, new Set(["s1", "s2", "s3"]), true, () => 0.9)).toBe("s2");
    // A null lastUsedAt sorts before every date.
    expect(chooseExamSet(sets, all, true, () => 0.9)).toBe("s2");
  });

  it("returns null for an empty list", () => {
    expect(chooseExamSet([], new Set(), false, () => 0)).toBeNull();
    expect(chooseExamSet([], new Set(), true, () => 0)).toBeNull();
  });
});
