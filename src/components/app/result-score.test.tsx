import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttemptStatusBadge, ResultScore } from "./result-score";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("AttemptStatusBadge", () => {
  it("shows a plain status for every stage, never hold or release wording", () => {
    const cases = [
      [{ status: "in_progress", points: null, maxPoints: null, passed: null }, "In progress"],
      [{ status: "submitted", points: null, maxPoints: null, passed: null }, "Being scored"],
      [{ status: "released", points: 9, maxPoints: 10, passed: true }, "Passed"],
      [{ status: "released", points: 2, maxPoints: 10, passed: false }, "Not passed"],
    ] as const;
    for (const [attempt, label] of cases) {
      const html = renderToStaticMarkup(<AttemptStatusBadge attempt={attempt} />);
      expect(text(html)).toBe(label);
      expect(html).toContain('data-testid="attempt-status"');
      expect(html).not.toMatch(/releas|awaiting|held/i);
    }
  });
});

describe("ResultScore", () => {
  it("puts the percentage first, then the points", () => {
    const t = text(renderToStaticMarkup(<ResultScore points={2} maxPoints={3} passed={false} />));
    // Both must be there, or indexOf(-1) would make the order check pass by accident.
    expect(t).toContain("66.7%");
    expect(t).toContain("2 / 3");
    expect(t.indexOf("66.7%")).toBeLessThan(t.indexOf("2 / 3"));
  });

  it("can leave the outcome to a separate status badge", () => {
    const t = text(renderToStaticMarkup(<ResultScore points={2} maxPoints={3} passed={false} outcome={false} />));
    expect(t).not.toMatch(/passed|fail/i);
  });

  it("names the outcome Passed or Not passed by default", () => {
    expect(text(renderToStaticMarkup(<ResultScore points={2} maxPoints={3} passed={false} />))).toContain("Not passed");
    expect(text(renderToStaticMarkup(<ResultScore points={3} maxPoints={3} passed />))).toContain("Passed");
  });

  it("shows no numbers before the score exists", () => {
    const t = text(renderToStaticMarkup(<ResultScore points={null} maxPoints={null} passed={null} />));
    expect(t).toBe("No score yet");
  });
});
