// Content of each curriculum card kind on the student start page (spec change 1, Task 3).
// Rendered to static HTML; the start server action is a fake.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CurriculumCard } from "@/lib/exam-start";
import type { StudentResultListItem } from "@/lib/results";

vi.mock("../actions", () => ({ startExam: async () => {} }));

const { CurriculumCardView } = await import("./curriculum-card");

const ID = "11111111-1111-4111-8111-111111111111";

function render(extra: Partial<CurriculumCard>, passed?: StudentResultListItem | null) {
  const card: CurriculumCard = { curriculumId: ID, name: "Pflege Ausbildung", position: 1, kind: "ready", attemptsLeft: 2, ...extra };
  return renderToStaticMarkup(<CurriculumCardView card={card} passedResult={passed ?? null} />);
}

function testIds(html: string) {
  return [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
}

/** Visible text without tags, for copy checks. */
function text(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("CurriculumCardView", () => {
  it("ready: name, attempts left, a different exam each attempt, result at once, Start exam", () => {
    const html = render({ kind: "ready", attemptsLeft: 2 });
    expect(testIds(html)).toEqual(expect.arrayContaining(["curriculum-card", "attempts-left", "start-exam"]));
    expect(text(html)).toContain("Pflege Ausbildung");
    expect(text(html)).toContain("2 attempts left");
    expect(text(html)).toMatch(/different exam/i);
    expect(text(html)).toMatch(/result is shown as soon as you submit/i);
    expect(text(html)).toContain("Start exam");
  });

  it("attempts left reads as words with a space after the number (textContent and screen readers)", () => {
    const html = render({ kind: "ready", attemptsLeft: 2 });
    const inner = html.match(/<p[^>]*data-testid="attempts-left"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(inner.replace(/<[^>]+>/g, "")).toBe("2 attempts left");
  });

  it("ready with one attempt left says it is the last one", () => {
    const html = render({ kind: "ready", attemptsLeft: 1 });
    expect(text(html)).toContain("1 attempt left");
    expect(text(html)).toMatch(/last attempt/i);
  });

  it("in progress: Resume links to the attempt, no start button", () => {
    const html = render({ kind: "in_progress", attemptId: "55555555-5555-4555-8555-555555555555", attemptsLeft: 2 });
    expect(testIds(html)).toContain("resume-exam");
    expect(testIds(html)).not.toContain("start-exam");
    expect(html).toContain('href="/exam/55555555-5555-4555-8555-555555555555"');
    expect(text(html)).toContain("Resume");
  });

  it("passed: success state with the percentage of the latest pass and a link to it", () => {
    const passed: StudentResultListItem = {
      id: "66666666-6666-4666-8666-666666666666",
      status: "released",
      curriculumId: ID,
      curriculumName: "Pflege Ausbildung",
      examSetName: "Set A",
      submittedAt: "2026-11-19T10:00:00Z",
      points: 23,
      maxPoints: 25,
      passed: true,
    };
    const html = render({ kind: "passed", attemptsLeft: 1 }, passed);
    expect(text(html)).toContain("Passed");
    expect(text(html)).toContain("92%");
    expect(html).toContain('href="/results/66666666-6666-4666-8666-666666666666"');
    expect(testIds(html)).not.toContain("start-exam");
    expect(testIds(html)).not.toContain("attempts-left");
  });

  it("passed without a readable result still shows the success state", () => {
    const html = render({ kind: "passed", attemptsLeft: 0 });
    expect(text(html)).toMatch(/you passed/i);
    expect(text(html)).not.toMatch(/\d+(\.\d)?%/);
  });

  it("blocked: please contact your trainer, no number promise, no start", () => {
    const html = render({ kind: "blocked", attemptsLeft: 0 });
    expect(testIds(html)).toContain("contact-trainer");
    expect(text(html)).toMatch(/please contact your trainer/i);
    expect(testIds(html)).not.toContain("attempts-left");
    expect(testIds(html)).not.toContain("start-exam");
    expect(text(html)).not.toMatch(/\bone more\b|another attempt|\d+ attempts?/i);
  });

  it("unavailable: no exam is available right now, please contact your trainer", () => {
    const html = render({ kind: "unavailable", attemptsLeft: 2 });
    expect(testIds(html)).toContain("contact-trainer");
    expect(text(html)).toContain("No exam is available right now, please contact your trainer.");
    expect(testIds(html)).not.toContain("start-exam");
    expect(testIds(html)).not.toContain("attempts-left");
  });

  it("calculating: being calculated, check again link, no numbers", () => {
    const html = render({ kind: "calculating", attemptsLeft: 1, attemptId: "77777777-7777-4777-8777-777777777777" });
    expect(testIds(html)).toContain("calculating");
    expect(html).toMatch(/<p[^>]*data-testid="calculating"[^>]*role="status"|<p[^>]*role="status"[^>]*data-testid="calculating"/);
    expect(text(html)).toContain("Your result is being calculated, please check again in a moment.");
    expect(html).toContain('href="/exam/start"');
    expect(text(html)).not.toMatch(/\d+(\.\d)?%|points/);
    expect(testIds(html)).not.toContain("start-exam");
  });

  it("never mentions review, release or waiting for the trainer", () => {
    for (const kind of ["ready", "in_progress", "passed", "blocked", "unavailable", "calculating"] as const) {
      expect(text(render({ kind, attemptId: "55555555-5555-4555-8555-555555555555" }))).not.toMatch(/review|releas|awaiting|waiting/i);
    }
  });
});
