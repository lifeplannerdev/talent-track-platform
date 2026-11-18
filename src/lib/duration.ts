// Exam durations are stored as whole minutes (exam_sets.time_limit_min) and entered and shown
// as hours and minutes ("2 h 30 min"). Pure helpers shared by staff and student screens.

/** Longest exam staff can set: 12 hours (DB check constraint in migration 0018 matches). */
export const MAX_DURATION_MIN = 720

/** 90 -> "1 h 30 min", 120 -> "2 h", 45 -> "45 min", 0 -> "0 min". */
export function formatDuration(totalMin: number): string {
  const safe = Number.isFinite(totalMin) && totalMin > 0 ? Math.round(totalMin) : 0
  const { hours, minutes } = splitDuration(safe)
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

export function splitDuration(totalMin: number): { hours: number; minutes: number } {
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 }
}

function part(v: number | string): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null
  const s = v.trim()
  if (s === '') return 0
  return /^\d+$/.test(s) ? Number(s) : null
}

/**
 * Hours and minutes from the form joined into minutes. An empty part counts as 0, but both
 * empty is no duration. Null for anything that is not a whole number, or minutes of 60 or more.
 */
export function durationFromParts(hours: number | string, minutes: number | string): number | null {
  if (typeof hours === 'string' && typeof minutes === 'string' && !hours.trim() && !minutes.trim()) return null
  const h = part(hours)
  const m = part(minutes)
  if (h === null || m === null || m >= 60) return null
  const total = h * 60 + m
  return Number.isSafeInteger(total) ? total : null
}
