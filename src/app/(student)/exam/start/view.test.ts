// Pure view helpers of the student start page: attempts-left wording and the results list
// grouped by curriculum (spec change 1: each curriculum is independent).
import { describe, expect, it } from "vitest";
import type { CurriculumCard } from "@/lib/exam-start";
import type { StudentResultListItem } from "@/lib/results";
import { attemptsLeftLabel, groupResultsByCurriculum, latestPass } from "./view";

const PFLEGE = "11111111-1111-4111-8111-111111111111";
const LIFE = "22222222-2222-4222-8222-222222222222";
const OLD = "33333333-3333-4333-8333-333333333333";

function card(curriculumId: string, name: string, position: number, extra: Partial<CurriculumCard> = {}): CurriculumCard {
  return { curriculumId, name, position, kind: "ready", attemptsLeft: 2, ...extra };
}

function result(id: string, curriculumId: string | null, curriculumName: string, extra: Partial<StudentResultListItem> = {}) {
  return {
    id,
    status: "released",
    curriculumId,
    curriculumName,
    examSetName: "Set",
    submittedAt: "2026-11-19T10:00:00Z",
    points: 9,
    maxPoints: 10,
    passed: true,
    ...extra,
  } satisfies StudentResultListItem;
}

describe("attemptsLeftLabel", () => {
  it("uses the singular for one attempt", () => {
    expect(attemptsLeftLabel(1)).toBe("1 attempt left");
  });
  it("uses the plural otherwise", () => {
    expect(attemptsLeftLabel(2)).toBe("2 attempts left");
    expect(attemptsLeftLabel(0)).toBe("0 attempts left");
  });
});

describe("groupResultsByCurriculum", () => {
  it("groups by curriculum in card position order, keeping each group's rows newest first", () => {
    const cards = [card(LIFE, "Life in Germany", 2), card(PFLEGE, "Pflege Ausbildung", 1)];
    const results = [
      result("a", PFLEGE, "Pflege Ausbildung"),
      result("b", LIFE, "Life in Germany"),
      result("c", PFLEGE, "Pflege Ausbildung", { passed: false }),
    ];
    const groups = groupResultsByCurriculum(results, cards);
    expect(groups.map((g) => g.name)).toEqual(["Pflege Ausbildung", "Life in Germany"]);
    expect(groups[0].rows.map((r) => r.kind === "result" && r.result.id)).toEqual(["a", "c"]);
  });

  it("adds a running attempt as an in-progress row without numbers, first in its group", () => {
    const cards = [card(PFLEGE, "Pflege Ausbildung", 1, { kind: "in_progress", attemptId: "run" })];
    const groups = groupResultsByCurriculum([result("a", PFLEGE, "Pflege Ausbildung")], cards);
    expect(groups[0].rows[0]).toEqual({ kind: "in_progress", attemptId: "run" });
    expect(groups[0].rows).toHaveLength(2);
  });

  it("leaves out curriculums without any attempt", () => {
    expect(groupResultsByCurriculum([], [card(PFLEGE, "Pflege Ausbildung", 1)])).toEqual([]);
  });

  it("puts results of curriculums no longer assigned after the assigned ones", () => {
    const cards = [card(PFLEGE, "Pflege Ausbildung", 1)];
    const groups = groupResultsByCurriculum(
      [result("old", OLD, "Alte Prüfung"), result("x", null, ""), result("a", PFLEGE, "Pflege Ausbildung")],
      cards,
    );
    expect(groups.map((g) => g.name)).toEqual(["Pflege Ausbildung", "Alte Prüfung", "Other exams"]);
  });
});

describe("latestPass", () => {
  it("returns the newest released pass of the curriculum", () => {
    const results = [
      result("fail", PFLEGE, "P", { passed: false }),
      result("new", PFLEGE, "P"),
      result("older", PFLEGE, "P"),
      result("other", LIFE, "L"),
    ];
    expect(latestPass(results, PFLEGE)?.id).toBe("new");
  });
  it("ignores attempts still being calculated", () => {
    const results = [result("calc", PFLEGE, "P", { status: "submitted", points: null, maxPoints: null, passed: null })];
    expect(latestPass(results, PFLEGE)).toBeNull();
  });
});
