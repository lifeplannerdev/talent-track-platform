import type { ExtraAttemptsActionResult } from "./actions";

// Staff-facing texts of the Extra attempts action (shared by the Extra attempts, Blocked and
// student pages). Pure, so they are unit-tested in messages.test.ts.

export const MAX_EXTRA_ATTEMPTS = 10;

const REFUSALS: Record<string, string> = {
  already_passed: "Nothing was given: this student has already passed this curriculum.",
  not_assigned: "Nothing was given: this curriculum is no longer assigned to this student. Reload the page.",
  invalid_n: `Give from 1 to ${MAX_EXTRA_ATTEMPTS} extra attempts.`,
  invalid_request: "Nothing was given: the student or curriculum was not found. Reload the page.",
};

/** Text for a refused or failed action: what happened and what to do. */
export function extraAttemptsMessage(result: Exclude<ExtraAttemptsActionResult, { ok: true }>): string {
  return REFUSALS[result.error] ?? "The extra attempts could not be given. Please try again.";
}

/** Confirmation after a successful action. */
export function extraAttemptsSuccess(p: {
  n: number;
  studentName: string;
  curriculumName: string;
  allowRepeats: boolean;
  wasBlocked: boolean;
  /** The allowance is still used up (0024): the block stays. */
  stillBlocked?: boolean;
}): string {
  const parts = [`Gave ${p.studentName} ${p.n} extra attempt${p.n === 1 ? "" : "s"} for ${p.curriculumName}.`];
  if (p.stillBlocked)
    parts.push("Still blocked: they have already used more attempts than they now have, so give more extra attempts to lift the block.");
  else if (p.wasBlocked) parts.push("The block is lifted.");
  if (p.allowRepeats) parts.push("Exam sets they already had may be given again.");
  return parts.join(" ");
}

/** The form's count: a whole number from 1 to 10, else null. */
export function parseExtraAttemptsCount(value: string): number | null {
  const v = value.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_EXTRA_ATTEMPTS ? n : null;
}
