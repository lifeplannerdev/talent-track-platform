import { describe, expect, it } from 'vitest'
import { scoreAttempt } from './scoring'
import type { Question } from './types'

function q(id: string, topic: string, points: number, correct = 'a'): Question {
  return {
    id,
    examSetId: 'set1',
    topic,
    difficulty: 'medium',
    stemDe: `Frage ${id}`,
    stemEn: `Question ${id}`,
    options: [
      { id: 'a', de: 'A', en: 'A' },
      { id: 'b', de: 'B', en: 'B' },
    ],
    correctOptionId: correct,
    points,
    status: 'approved',
  }
}

describe('scoreAttempt', () => {
  it('all correct gives 100 and passed', () => {
    const qs = [q('1', 'Math', 1), q('2', 'Math', 1)]
    const r = scoreAttempt(qs, { '1': 'a', '2': 'a' }, 60)
    expect(r).toMatchObject({ points: 2, max: 2, percent: 100, passed: true })
  })

  it('unanswered (null or missing) counts zero', () => {
    const qs = [q('1', 'Math', 1), q('2', 'Math', 1), q('3', 'Math', 1)]
    const r = scoreAttempt(qs, { '1': 'a', '2': null }, 60)
    expect(r.points).toBe(1)
    expect(r.max).toBe(3)
    expect(r.percent).toBe(33.33)
    expect(r.passed).toBe(false)
  })

  it('exactly equal to pass mark passes', () => {
    const qs = [q('1', 'T', 1), q('2', 'T', 1), q('3', 'T', 1), q('4', 'T', 1), q('5', 'T', 1)]
    const r = scoreAttempt(qs, { '1': 'a', '2': 'a', '3': 'a', '4': 'b', '5': 'b' }, 60)
    expect(r.percent).toBe(60)
    expect(r.passed).toBe(true)
  })

  it('just below the pass mark fails', () => {
    const qs = [q('1', 'T', 1), q('2', 'T', 1), q('3', 'T', 1), q('4', 'T', 1), q('5', 'T', 1)]
    const r = scoreAttempt(qs, { '1': 'a', '2': 'a', '3': 'b', '4': 'b', '5': 'b' }, 60)
    expect(r.passed).toBe(false)
  })

  it('passed uses the unrounded ratio', () => {
    // 2/3 = 66.666..% rounds to 66.67 but must fail a 66.67 pass mark
    const qs = [q('1', 'T', 1), q('2', 'T', 1), q('3', 'T', 1)]
    const r = scoreAttempt(qs, { '1': 'a', '2': 'a', '3': 'b' }, 66.67)
    expect(r.percent).toBe(66.67)
    expect(r.passed).toBe(false)
  })

  it('applies point weights', () => {
    const qs = [q('1', 'T', 3), q('2', 'T', 1)]
    const r = scoreAttempt(qs, { '1': 'a', '2': 'b' }, 50)
    expect(r.points).toBe(3)
    expect(r.max).toBe(4)
    expect(r.percent).toBe(75)
    expect(r.passed).toBe(true)
  })

  it('byTopic sums equal the totals', () => {
    const qs = [q('1', 'Math', 2), q('2', 'Logic', 3), q('3', 'Math', 1)]
    const r = scoreAttempt(qs, { '1': 'a', '2': 'b', '3': 'a' }, 50)
    expect(r.byTopic).toEqual({
      Math: { points: 3, max: 3 },
      Logic: { points: 0, max: 3 },
    })
    const sum = Object.values(r.byTopic).reduce(
      (acc, t) => ({ points: acc.points + t.points, max: acc.max + t.max }),
      { points: 0, max: 0 },
    )
    expect(sum).toEqual({ points: r.points, max: r.max })
  })

  it('zero max gives 0 percent and not passed', () => {
    const r = scoreAttempt([], {}, 0)
    expect(r).toEqual({ points: 0, max: 0, percent: 0, passed: false, byTopic: {} })
  })
})
