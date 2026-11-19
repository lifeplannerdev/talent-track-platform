// Staff-facing stage of one attempt (spec change 1: marks are shown at once, there is no hold or
// release step). Pure, shared by the attempts list, the evaluation view and the student page.

export type AttemptRowStatus = "in_progress" | "submitted" | "released";
export type AttemptStatusKind = "in_progress" | "scoring" | "passed" | "not_passed";

export function attemptStatusKind(a: {
  status: AttemptRowStatus;
  points: number | null;
  maxPoints: number | null;
  passed: boolean | null;
}): AttemptStatusKind {
  if (a.status === "in_progress") return "in_progress";
  // Submitted but not scored yet (scoring runs right after submit; a crash leaves it here until healed).
  if (a.points === null || a.maxPoints === null || a.passed === null) return "scoring";
  return a.passed ? "passed" : "not_passed";
}

export const ATTEMPT_STATUS: Record<AttemptStatusKind, { label: string; variant: "outline" | "warning" | "success" | "destructive" }> = {
  in_progress: { label: "In progress", variant: "outline" },
  scoring: { label: "Being scored", variant: "warning" },
  passed: { label: "Passed", variant: "success" },
  not_passed: { label: "Not passed", variant: "destructive" },
};

/** Status filter of the attempts list ("" = all attempts). */
export const ATTEMPT_FILTERS = [
  { value: "", label: "All attempts" },
  { value: "in_progress", label: "In progress" },
  { value: "scoring", label: "Being scored" },
  { value: "passed", label: "Passed" },
  { value: "not_passed", label: "Not passed" },
] as const;

const ALL: AttemptRowStatus[] = ["in_progress", "submitted", "released"];

/** Which attempt rows a filter value selects; unknown (or old) values select every attempt. */
export function attemptFilterQuery(value: string): { statuses: AttemptRowStatus[]; passed?: boolean } {
  switch (value) {
    case "in_progress":
      return { statuses: ["in_progress"] };
    case "scoring":
      return { statuses: ["submitted"] };
    case "passed":
      return { statuses: ["released"], passed: true };
    case "not_passed":
      return { statuses: ["released"], passed: false };
    default:
      return { statuses: [...ALL] };
  }
}
