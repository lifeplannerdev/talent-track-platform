import { describe, expect, it } from "vitest";
import { topicTotals } from "./report";

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
