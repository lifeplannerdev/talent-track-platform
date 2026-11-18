// Percentages are the headline result everywhere (owner decision 2026-11-18: "mainly focus on
// percentage, passing percentage is 90%"). Points are whole numbers, so pass/fail and the display
// are decided with integer arithmetic: no float rounding can turn 89.6% into a pass or a "90%".

/** The standard pass mark for new exam sets. Staff can still change it per exam set. */
export const DEFAULT_PASS_MARK_PERCENT = 90;

/** points / max >= passMark %, compared exactly as points * 100 >= passMark * max. */
export function meetsPassMark(points: number, max: number, passMarkPercent: number): boolean {
  if (max <= 0) return false;
  return points * 100 >= passMarkPercent * max;
}

/** The share as a plain number (0 to 100), for bars. Not for display text: use formatPercent. */
export function percentValue(points: number, max: number): number {
  return max > 0 ? (points / max) * 100 : 0;
}

/**
 * "92%" when whole, else one decimal ("66.7%"). Rounds half up to one decimal, except that it
 * never rounds up to a whole number: 89.95% shows "89.9%", not "90%", so a failed result can never
 * read as the (whole-number) pass mark. Rounding down to a whole number is fine (90.04% -> "90%").
 */
export function formatPercent(points: number, max: number): string {
  if (max <= 0) return "0%";
  const scaled = points * 1000; // tenths of a percent, times max
  let tenths = Math.floor((2 * scaled + max) / (2 * max)); // round half up
  if (tenths % 10 === 0 && tenths * max > scaled) tenths -= 1; // rounded up onto a whole number
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`;
}
