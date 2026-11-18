// Pure helpers for the score report (student) and the evaluation view (staff).

export type TopicTotal = { topic: string; points: number; max: number };

/**
 * The exam set's current pass mark, but only if it agrees with the stored outcome. Staff may
 * change the pass mark after scoring; a pass mark that contradicts "passed" would mislead, so
 * it is left out (null) rather than shown.
 */
export function consistentPassMark(r: { percent: number; passed: boolean; passMarkPercent: number | null | undefined }): number | null {
  if (r.passMarkPercent === null || r.passMarkPercent === undefined) return null;
  return r.percent >= r.passMarkPercent === r.passed ? r.passMarkPercent : null;
}

/** Points per topic from scored questions (unscored ones are skipped), sorted by topic. */
export function topicTotals(
  questions: { topic: string | null; awardedPoints: number | null; maxPoints: number | null }[],
): TopicTotal[] {
  const totals = new Map<string, TopicTotal>();
  for (const q of questions) {
    if (q.awardedPoints === null || q.maxPoints === null) continue;
    const topic = q.topic?.trim() || "Other";
    const t = totals.get(topic) ?? { topic, points: 0, max: 0 };
    t.points += q.awardedPoints;
    t.max += q.maxPoints;
    totals.set(topic, t);
  }
  return [...totals.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}
