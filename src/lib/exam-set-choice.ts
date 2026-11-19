// Which exam set a new attempt gets (spec change 1). Pure, so it is unit-tested; startAttempt
// reads the curriculum's sets and the student's earlier attempts and calls it.

/**
 * Whether an exam set's approved questions (their topics) can fill one paper at all, seen or not:
 * question_count questions, and with a topic mix enough of every topic. Sets that cannot are left
 * out of the choice (staff are still building them); the curriculum card then says so.
 */
export function canFillPaper(
  set: { questionCount: number; topicMix: Record<string, number> | null },
  approvedTopics: readonly string[],
): boolean {
  if (approvedTopics.length < set.questionCount) return false;
  const mix = set.topicMix ?? {};
  for (const [topic, need] of Object.entries(mix)) {
    if (approvedTopics.filter((t) => t === topic).length < need) return false;
  }
  return true;
}

/**
 * A random set among those the student has not used yet. When every set is used and staff
 * allowed repeats, the least recently used set (a set never used counts as oldest; ties keep the
 * list order). Otherwise null. random returns a number in [0, 1).
 */
export function chooseExamSet(
  sets: { id: string; lastUsedAt: string | null }[],
  usedIds: Set<string>,
  allowRepeats: boolean,
  random: () => number,
): string | null {
  const unused = sets.filter((s) => !usedIds.has(s.id));
  if (unused.length > 0) {
    const i = Math.min(unused.length - 1, Math.floor(random() * unused.length));
    return unused[i].id;
  }
  if (!allowRepeats || sets.length === 0) return null;
  const time = (s: { lastUsedAt: string | null }) => (s.lastUsedAt === null ? -Infinity : Date.parse(s.lastUsedAt));
  return sets.reduce((oldest, s) => (time(s) < time(oldest) ? s : oldest)).id;
}
