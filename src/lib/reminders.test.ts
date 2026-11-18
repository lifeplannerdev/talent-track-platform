import { describe, expect, it } from 'vitest'
import { REMINDER_GRACE_MS, reminderDue, reminderMarks, reminderText } from './reminders'

const MIN = 60_000

describe('reminderMarks', () => {
  it('lists every multiple of the interval below the duration, plus 5 and 1 minutes', () => {
    expect(reminderMarks(60 * MIN, 15)).toEqual([45, 30, 15, 5, 1])
    expect(reminderMarks(150 * MIN, 15)).toEqual([135, 120, 105, 90, 75, 60, 45, 30, 15, 5, 1])
  })

  it('does not repeat a final mark that is already an interval mark', () => {
    expect(reminderMarks(20 * MIN, 5)).toEqual([15, 10, 5, 1])
    expect(reminderMarks(3 * MIN, 1)).toEqual([2, 1])
  })

  it('an exam shorter than the interval only gets the final reminders', () => {
    expect(reminderMarks(10 * MIN, 15)).toEqual([5, 1])
    expect(reminderMarks(15 * MIN, 15)).toEqual([5, 1])
  })

  it('leaves out final marks the exam is too short for', () => {
    expect(reminderMarks(5 * MIN, 15)).toEqual([1])
    expect(reminderMarks(1 * MIN, 15)).toEqual([])
  })

  it('interval 0 turns all reminders off', () => {
    expect(reminderMarks(60 * MIN, 0)).toEqual([])
  })
})

describe('reminderDue', () => {
  const total = 60 * MIN
  const none = new Set<number>()

  it('nothing at the start or between marks', () => {
    expect(reminderDue(total, total, 15, none)).toBeNull()
    expect(reminderDue(50 * MIN, total, 15, none)).toBeNull()
  })

  it('shows a mark once the remaining time reaches it', () => {
    expect(reminderDue(45 * MIN, total, 15, none)).toBe(45)
    expect(reminderDue(45 * MIN - 1000, total, 15, none)).toBe(45)
    expect(reminderDue(30 * MIN - 200, total, 15, none)).toBe(30)
    expect(reminderDue(5 * MIN - 1, total, 15, none)).toBe(5)
    expect(reminderDue(1 * MIN - 1, total, 15, none)).toBe(1)
  })

  it('never shows a mark twice', () => {
    expect(reminderDue(30 * MIN - 200, total, 15, new Set([30]))).toBeNull()
  })

  it('reload mid-exam: a mark passed longer ago than the grace period is not shown late', () => {
    expect(reminderDue(27 * MIN, total, 15, none)).toBeNull()
    expect(reminderDue(30 * MIN - REMINDER_GRACE_MS - 1, total, 15, none)).toBeNull()
    expect(reminderDue(30 * MIN - REMINDER_GRACE_MS + 1, total, 15, none)).toBe(30)
  })

  it('clock jump over several marks: only the latest one, if still fresh', () => {
    // Jump from 50 min left to 14.9 min left: 45 and 30 are stale, 15 is current.
    expect(reminderDue(15 * MIN - 6000, total, 15, none)).toBe(15)
  })

  it('a clock jump backwards does not repeat a shown mark', () => {
    expect(reminderDue(45 * MIN - 100, total, 15, new Set([45, 30]))).toBeNull()
  })

  it('interval 0 or time up gives nothing', () => {
    expect(reminderDue(30 * MIN, total, 0, none)).toBeNull()
    expect(reminderDue(0, total, 15, none)).toBeNull()
    expect(reminderDue(-5000, total, 15, none)).toBeNull()
  })

  it('exam shorter than the interval: only 5 and 1 minutes', () => {
    expect(reminderDue(10 * MIN - 100, 10 * MIN, 15, none)).toBeNull()
    expect(reminderDue(5 * MIN - 100, 10 * MIN, 15, none)).toBe(5)
  })
})

describe('reminderText', () => {
  it('says how many minutes are left', () => {
    expect(reminderText(30)).toBe('30 minutes left.')
    expect(reminderText(1)).toBe('1 minute left.')
    expect(reminderText(90)).toBe('1 h 30 min left.')
    expect(reminderText(120)).toBe('2 h left.')
  })
})
