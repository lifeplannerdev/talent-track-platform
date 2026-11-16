// Exam set settings: validation shared by the staff form and saveExamSet, plus the topic mix
// text format used by the form ("topic: count", one per line) and the pool warnings.

export type TopicMix = Record<string, number>

export type ExamSetFields = {
  name: string
  questionCount: number | string
  timeLimitMin: number | string
  passMarkPercent: number | string
  maxAttempts: number | string
  holdResult: boolean
  topicMix: unknown
}

export type ExamSetValue = {
  name: string
  questionCount: number
  timeLimitMin: number
  passMarkPercent: number
  maxAttempts: number
  holdResult: boolean
  topicMix: TopicMix
}

export type ExamSetField = keyof ExamSetFields

/** A whole number from a number or a digit string, else null. */
function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) {
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

function validateTopicMix(mix: unknown, questionCount: number | null): { ok: true; mix: TopicMix } | { ok: false; message: string } {
  if (typeof mix !== 'object' || mix === null || Array.isArray(mix)) return { ok: false, message: 'Topic mix must be a list of topics and counts' }
  const out: TopicMix = Object.create(null)
  let total = 0
  for (const [rawTopic, count] of Object.entries(mix)) {
    const topic = rawTopic.trim()
    if (!topic) return { ok: false, message: 'Every topic in the mix needs a name' }
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      return { ok: false, message: `Count for topic "${topic}" must be a whole number of 0 or more` }
    }
    if (Object.hasOwn(out, topic)) return { ok: false, message: `Topic "${topic}" is listed twice` }
    total += count
    if (count > 0) out[topic] = count
  }
  if (Object.keys(out).length > 0 && questionCount !== null && total !== questionCount) {
    return { ok: false, message: `Topic counts add up to ${total}, but the exam has ${questionCount} questions` }
  }
  // Plain object for JSON / equality.
  return { ok: true, mix: { ...out } }
}

export function validateExamSetFields(
  fields: ExamSetFields,
): { ok: true; value: ExamSetValue } | { ok: false; errors: Partial<Record<ExamSetField, string>> } {
  const errors: Partial<Record<ExamSetField, string>> = {}
  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  if (!name) errors.name = 'Enter a name'
  else if (name.length > 120) errors.name = 'Use at most 120 characters'

  const questionCount = toInt(fields.questionCount)
  if (questionCount === null || questionCount < 1 || questionCount > 500) errors.questionCount = 'Enter a whole number from 1 to 500'
  const timeLimitMin = toInt(fields.timeLimitMin)
  if (timeLimitMin === null || timeLimitMin < 1 || timeLimitMin > 600) errors.timeLimitMin = 'Enter a whole number of minutes from 1 to 600'
  const passMarkPercent = toInt(fields.passMarkPercent)
  if (passMarkPercent === null || passMarkPercent < 0 || passMarkPercent > 100) errors.passMarkPercent = 'Enter a whole number from 0 to 100'
  const maxAttempts = toInt(fields.maxAttempts)
  if (maxAttempts === null || maxAttempts < 1 || maxAttempts > 50) errors.maxAttempts = 'Enter a whole number from 1 to 50'
  if (typeof fields.holdResult !== 'boolean') errors.holdResult = 'Choose whether results are held'

  const mix = validateTopicMix(fields.topicMix, errors.questionCount ? null : questionCount)
  if (!mix.ok) errors.topicMix = mix.message

  if (Object.keys(errors).length > 0 || !mix.ok) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name,
      questionCount: questionCount!,
      timeLimitMin: timeLimitMin!,
      passMarkPercent: passMarkPercent!,
      maxAttempts: maxAttempts!,
      holdResult: fields.holdResult,
      topicMix: mix.mix,
    },
  }
}

/** Reads the form's topic mix text: one "topic: count" (or "topic = count") per line. */
export function parseTopicMixText(text: string): { ok: true; mix: TopicMix } | { ok: false; message: string } {
  // Null prototype, so a topic such as "__proto__" becomes an own key (copied out below).
  const mix: TopicMix = Object.create(null)
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const m = /^(.*\S)\s*[:=]\s*(\d+)$/.exec(line)
    if (!m) return { ok: false, message: `Line ${i + 1}: write "topic: count"` }
    const topic = m[1].trim()
    if (Object.hasOwn(mix, topic)) return { ok: false, message: `Line ${i + 1}: topic "${topic}" is listed twice` }
    mix[topic] = Number(m[2])
  }
  return { ok: true, mix: { ...mix } }
}

export function formatTopicMix(mix: TopicMix | null | undefined): string {
  return Object.entries(mix ?? {})
    .map(([topic, n]) => `${topic}: ${n}`)
    .join('\n')
}

/** Retakes draw only unseen questions, so the pool should hold at least three papers. */
export function poolWarning(approvedCount: number, questionCount: number): string | null {
  const recommended = 3 * questionCount
  if (approvedCount >= recommended) return null
  return `Only ${approvedCount} approved question${approvedCount === 1 ? '' : 's'}; at least ${recommended} (3 x ${questionCount}) are recommended so retakes get unseen questions.`
}

/** Warnings (not errors) for an exam set against its approved questions. */
export function examSetWarnings(
  set: { questionCount: number; topicMix: TopicMix },
  approved: readonly { topic: string }[],
): string[] {
  const warnings: string[] = []
  const byTopic = new Map<string, number>()
  for (const q of approved) byTopic.set(q.topic, (byTopic.get(q.topic) ?? 0) + 1)
  for (const [topic, need] of Object.entries(set.topicMix)) {
    const have = byTopic.get(topic) ?? 0
    if (have === 0) warnings.push(`Topic "${topic}" has no approved questions in this exam set.`)
    else if (have < need) warnings.push(`Topic "${topic}" has ${have} approved question${have === 1 ? '' : 's'}, but each paper needs ${need}.`)
  }
  const pool = poolWarning(approved.length, set.questionCount)
  if (pool) warnings.push(pool)
  return warnings
}
