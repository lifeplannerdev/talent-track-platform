import type { Question } from './types'

export type ScoreResult = {
  points: number
  max: number
  percent: number
  passed: boolean
  byTopic: Record<string, { points: number; max: number }>
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
  const byTopic: ScoreResult['byTopic'] = {}

  for (const question of questions) {
    const earned = answers[question.id] === question.correctOptionId ? question.points : 0
    points += earned
    max += question.points
    const topic = (byTopic[question.topic] ??= { points: 0, max: 0 })
    topic.points += earned
    topic.max += question.points
  }

  if (max === 0) return { points: 0, max: 0, percent: 0, passed: false, byTopic }

  const ratio = points / max
  return {
    points,
    max,
    percent: Math.round(ratio * 10000) / 100,
    // Compare the unrounded ratio so rounding can never flip a result.
    passed: ratio >= passMarkPercent / 100,
    byTopic,
  }
}
