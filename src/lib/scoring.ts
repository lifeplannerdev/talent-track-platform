import { meetsPassMark } from './percent'
import type { Question } from './types'

export type ScoreResult = {
  points: number
  max: number
  percent: number
  passed: boolean
  byTopic: Record<string, { points: number; max: number }>
  /** Points awarded per question id; sums to points. */
  byQuestion: Record<string, number>
}

// answers is keyed by question id; the value is the chosen option id or null.
// A missing key or null counts as unanswered (zero points).
export function scoreAttempt(
  questions: Question[],
  answers: Record<string, string | null>,
  passMarkPercent: number,
): ScoreResult {
  let points = 0
  let max = 0
  // Map avoids prototype hazards for topics like "__proto__".
  const topics = new Map<string, { points: number; max: number }>()
  const byQuestion: Record<string, number> = Object.create(null)

  for (const question of questions) {
    const earned = answers[question.id] === question.correctOptionId ? question.points : 0
    points += earned
    byQuestion[question.id] = earned
    max += question.points
    const topic = topics.get(question.topic) ?? { points: 0, max: 0 }
    topic.points += earned
    topic.max += question.points
    topics.set(question.topic, topic)
  }

  const byTopic: ScoreResult['byTopic'] = {}
  for (const [name, totals] of topics) {
    Object.defineProperty(byTopic, name, {
      value: totals,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }

  if (max === 0) return { points: 0, max: 0, percent: 0, passed: false, byTopic, byQuestion: { ...byQuestion } }

  const ratio = points / max
  return {
    points,
    max,
    percent: Math.round(ratio * 10000) / 100,
    // Exact comparison (points * 100 >= pass mark * max), so rounding can never flip a result.
    passed: meetsPassMark(points, max, passMarkPercent),
    byTopic,
    byQuestion: { ...byQuestion },
  }
}
