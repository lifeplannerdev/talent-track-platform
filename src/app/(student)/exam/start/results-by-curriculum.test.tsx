// "Your results" on the start page: grouped per curriculum, percentage first, no numbers for an
// attempt that is running or still being calculated.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResultGroup } from "./view";
import { ResultsByCurriculum } from "./results-by-curriculum";

function text(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const groups: ResultGroup[] = [
  {
    key: "p",
    name: "Pflege Ausbildung",
    rows: [
      { kind: "in_progress", attemptId: "11111111-1111-4111-8111-111111111111" },
      {
        kind: "result",
        result: {
          id: "22222222-2222-4222-8222-222222222222",
          status: "submitted",
          curriculumId: "p",
          curriculumName: "Pflege Ausbildung",
          examSetName: "Set B",
          submittedAt: "2026-11-19T11:00:00Z",
          points: null,
          maxPoints: null,
          passed: null,
        },
      },
      {
        kind: "result",
        result: {
          id: "33333333-3333-4333-8333-333333333333",
          status: "released",
          curriculumId: "p",
          curriculumName: "Pflege Ausbildung",
          examSetName: "Set A",
          submittedAt: "2026-11-18T10:00:00Z",
          points: 2,
          maxPoints: 3,
          passed: false,
        },
      },
    ],
  },
  {
    key: "l",
    name: "Life in Germany",
    rows: [
      {
        kind: "result",
        result: {
          id: "44444444-4444-4444-8444-444444444444",
          status: "released",
          curriculumId: "l",
          curriculumName: "Life in Germany",
          examSetName: "Set L",
          submittedAt: "2026-11-17T10:00:00Z",
          points: 10,
          maxPoints: 10,
          passed: true,
        },
      },
    ],
  },
];

describe("ResultsByCurriculum", () => {
  it("renders nothing without results", () => {
    expect(renderToStaticMarkup(<ResultsByCurriculum groups={[]} />)).toBe("");
  });

  it("has one group per curriculum, in order, with its heading", () => {
    const html = renderToStaticMarkup(<ResultsByCurriculum groups={groups} />);
    expect(html).toContain('data-testid="results-list"');
    expect(html.match(/data-testid="results-group"/g)).toHaveLength(2);
    expect(text(html).indexOf("Pflege Ausbildung")).toBeLessThan(text(html).indexOf("Life in Germany"));
  });

  it("shows the percentage first, then points and the outcome, linking to the result", () => {
    const html = renderToStaticMarkup(<ResultsByCurriculum groups={groups} />);
    const t = text(html);
    expect(t).toContain("66.7%");
    expect(t.indexOf("66.7%")).toBeLessThan(t.indexOf("2 / 3 points"));
    expect(t).toContain("Not passed");
    expect(t).toContain("100%");
    expect(t).toContain("Passed");
    expect(html).toContain('href="/results/33333333-3333-4333-8333-333333333333"');
  });

  it("shows running and uncalculated attempts without numbers", () => {
    const html = renderToStaticMarkup(<ResultsByCurriculum groups={[{ ...groups[0], rows: groups[0].rows.slice(0, 2) }]} />);
    const t = text(html);
    expect(t).toContain("In progress");
    expect(t).toContain("Being calculated");
    expect(t).not.toMatch(/\d+(\.\d)?%|points/);
    expect(html).toContain('href="/exam/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('href="/results/22222222-2222-4222-8222-222222222222"');
  });
});
