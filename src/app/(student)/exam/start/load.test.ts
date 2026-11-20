// The start page loads the results only after getExamStartState has settled the attempts, so a
// card that a heal just made "passed" never sits next to a result row read before the heal.
import { describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ events: [] as string[], release: () => {} }));

vi.mock("@/lib/exam-start", () => ({
  getExamStartState: (studentId: string) =>
    new Promise((resolve) => {
      log.events.push(`state:start:${studentId}`);
      log.release = () => {
        log.events.push("state:settled");
        resolve([{ curriculumId: "c", name: "C", position: 1, kind: "passed", attemptsLeft: 1 }]);
      };
    }),
}));
vi.mock("@/lib/results", () => ({
  listStudentResults: async (studentId: string) => {
    log.events.push(`results:${studentId}`);
    return [];
  },
}));

const { loadStartPage } = await import("./load");

describe("loadStartPage", () => {
  it("reads the results after the cards (and their settlement) are done", async () => {
    const pending = loadStartPage("s1");
    await new Promise((r) => setTimeout(r, 10));
    expect(log.events).toEqual(["state:start:s1"]);
    log.release();
    await expect(pending).resolves.toEqual({
      cards: [{ curriculumId: "c", name: "C", position: 1, kind: "passed", attemptsLeft: 1 }],
      results: [],
    });
    expect(log.events).toEqual(["state:start:s1", "state:settled", "results:s1"]);
  });
});
