import type { GrantActionResult } from "./actions";

const REFUSALS: Record<string, string> = {
  grant_exists: "This student already has an unused attempt for this exam.",
  in_progress: "This student is taking an exam in this curriculum right now.",
  result_pending: "A result in this curriculum is awaiting release. Release it first, then give an attempt.",
  assignment_passed: "This student has already passed this curriculum.",
  not_assigned: "This exam is not assigned to this student any more.",
  exam_set_not_found: "This exam no longer exists.",
};

/** Staff-facing text for a refused grant. */
export function grantMessage(result: Exclude<GrantActionResult, { ok: true }>): string {
  if (result.error === "shortfall") {
    const n = result.unseenAvailable;
    return `Only ${n} unseen question${n === 1 ? "" : "s"} left, ${result.needed} needed`;
  }
  return REFUSALS[result.error] ?? "The attempt could not be granted. Please try again.";
}
