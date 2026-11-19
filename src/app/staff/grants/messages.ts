import type { ExtraAttemptsActionResult } from "./actions";

const REFUSALS: Record<string, string> = {
  already_passed: "This student has already passed this curriculum.",
  not_assigned: "This curriculum is not assigned to this student any more.",
  invalid_n: "Give from 1 to 10 extra attempts.",
};

/** Staff-facing text for refused extra attempts. */
export function extraAttemptsMessage(result: Exclude<ExtraAttemptsActionResult, { ok: true }>): string {
  return REFUSALS[result.error] ?? "The extra attempts could not be given. Please try again.";
}
