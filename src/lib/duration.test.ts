import { describe, expect, it } from 'vitest'
import { durationFromParts, formatDuration, MAX_DURATION_MIN, splitDuration } from './duration'

describe('formatDuration', () => {
  it('writes hours and minutes, leaving out a zero part', () => {
    expect(formatDuration(90)).toBe('1 h 30 min')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(1)).toBe('1 min')
    expect(formatDuration(150)).toBe('2 h 30 min')
    expect(formatDuration(720)).toBe('12 h')
  })

  it('shows 0 min for zero and treats bad input as 0', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(-5)).toBe('0 min')
    expect(formatDuration(Number.NaN)).toBe('0 min')
  })
})

describe('splitDuration', () => {
  it('splits minutes into whole hours and the rest', () => {
    expect(splitDuration(150)).toEqual({ hours: 2, minutes: 30 })
    expect(splitDuration(45)).toEqual({ hours: 0, minutes: 45 })
    expect(splitDuration(120)).toEqual({ hours: 2, minutes: 0 })
  })
})

describe('durationFromParts', () => {
  it('joins hours and minutes (strings from the form or numbers) into minutes', () => {
    expect(durationFromParts('2', '30')).toBe(150)
    expect(durationFromParts('0', '45')).toBe(45)
    expect(durationFromParts(1, 0)).toBe(60)
    expect(durationFromParts('', '20')).toBe(20)
    expect(durationFromParts('3', '')).toBe(180)
  })

  it('returns null for fractions, negatives, text or minutes of 60 or more', () => {
    expect(durationFromParts('1.5', '0')).toBeNull()
    expect(durationFromParts('-1', '0')).toBeNull()
    expect(durationFromParts('x', '0')).toBeNull()
    expect(durationFromParts('1', '60')).toBeNull()
    expect(durationFromParts('', '')).toBeNull()
  })

  it('round-trips with splitDuration', () => {
    for (const m of [1, 59, 60, 61, 150, MAX_DURATION_MIN]) {
      const { hours, minutes } = splitDuration(m)
      expect(durationFromParts(hours, minutes)).toBe(m)
    }
  })

  it('allows exams up to 12 hours', () => {
    expect(MAX_DURATION_MIN).toBe(720)
  })
})
