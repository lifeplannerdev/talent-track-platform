// Pure view helpers for the student start page (tested in view.test.ts).
import type { CurriculumCard } from "@/lib/exam-start";
import type { StudentResultListItem } from "@/lib/results";

export function attemptsLeftLabel(n: number): string {
  return n === 1 ? "1 attempt left" : `${n} attempts left`;
}

export type ResultRow =
  | { kind: "in_progress"; attemptId: string }
  | { kind: "result"; result: StudentResultListItem };

export type ResultGroup = { key: string; name: string; rows: ResultRow[] };

/**
 * The student's attempts grouped per curriculum (each curriculum is its own exam). Groups follow
 * the cards' position order; curriculums no longer assigned come after, by name, and attempts
 * whose curriculum is not readable last ("Other exams"). A running attempt (from its card) is the
 * first row of its group. Rows keep the results' order (newest first).
 */
export function groupResultsByCurriculum(results: StudentResultListItem[], cards: CurriculumCard[]): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  const ordered = [...cards].sort((a, b) => a.position - b.position);
  for (const c of ordered) {
    const rows: ResultRow[] = c.kind === "in_progress" && c.attemptId ? [{ kind: "in_progress", attemptId: c.attemptId }] : [];
    groups.set(c.curriculumId, { key: c.curriculumId, name: c.name, rows });
  }
  const extra = new Map<string, ResultGroup>();
  for (const r of results) {
    const key = r.curriculumId ?? "";
    const group =
      groups.get(key) ??
      extra.get(key) ??
      extra.set(key, { key: key || "other", name: key ? r.curriculumName || "Exam" : "Other exams", rows: [] }).get(key)!;
    group.rows.push({ kind: "result", result: r });
  }
  const unassigned = [...extra.entries()]
    .sort(([a, ga], [b, gb]) => (a === "" ? 1 : b === "" ? -1 : ga.name.localeCompare(gb.name)))
    .map(([, g]) => g);
  return [...groups.values(), ...unassigned].filter((g) => g.rows.length > 0);
}

/** The newest released pass in a curriculum (results are newest first), for the passed card. */
export function latestPass(results: StudentResultListItem[], curriculumId: string): StudentResultListItem | null {
  return (
    results.find(
      (r) => r.curriculumId === curriculumId && r.status === "released" && r.passed === true && r.points !== null && r.maxPoints !== null,
    ) ?? null
  );
}
