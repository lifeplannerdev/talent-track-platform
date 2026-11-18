// Time reminders on the exam screen ("30 minutes left."). Pure functions: the exam client feeds
// them the remaining time from its server-anchored countdown, so they never drift on their own.
import { formatDuration } from './duration'

const MIN = 60_000

/** Final reminders shown when the exam is long enough, besides the interval ones. */
const FINAL_MARKS = [5, 1]

/**
 * A mark is shown only while it is fresh: up to this long after the remaining time crossed it.
 * After a reload or a clock jump an old mark is skipped instead of showing a wrong number.
 */
export const REMINDER_GRACE_MS = 60_000

/**
 * Minutes-left marks for an exam of totalMs with a reminder every intervalMin minutes, largest
 * first: every multiple of the interval below the duration (counted from the start, so they
 * coincide with remaining 15, 30, ...), plus 5 and 1 minutes. Interval 0 turns reminders off.
 */
export function reminderMarks(totalMs: number, intervalMin: number): number[] {
  if (!(intervalMin > 0) || !(totalMs > 0)) return []
  const marks = new Set<number>()
  for (let m = intervalMin; m * MIN < totalMs; m += intervalMin) marks.add(m)
  for (const m of FINAL_MARKS) if (m * MIN < totalMs) marks.add(m)
  return [...marks].sort((a, b) => b - a)
}

/**
 * The mark (minutes left) to show now, or null. Of the marks the remaining time has reached and
 * that were not shown yet, the latest (smallest) one, and only while it is still fresh.
 */
export function reminderDue(
  remainingMs: number,
  totalMs: number,
  intervalMin: number,
  alreadyShown: ReadonlySet<number>,
): number | null {
  if (!(remainingMs > 0)) return null
  const crossed = reminderMarks(totalMs, intervalMin).filter((m) => remainingMs <= m * MIN)
  if (crossed.length === 0) return null
  const latest = crossed[crossed.length - 1]
  if (alreadyShown.has(latest)) return null
  return remainingMs > latest * MIN - REMINDER_GRACE_MS ? latest : null
}

export function reminderText(minutesLeft: number): string {
  if (minutesLeft >= 60) return `${formatDuration(minutesLeft)} left.`
  return `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} left.`
}
