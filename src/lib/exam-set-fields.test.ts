import { describe, expect, it } from 'vitest'
import {
  curriculumWarnings,
  DEFAULT_MAX_ATTEMPTS,
  examSetSummary,
  examSetWarnings,
  formatTopicMix,
  parseTopicMixText,
  poolWarning,
  validateCurriculumFields,
  validateExamSetFields,
} from './exam-set-fields'

const base = {
  name: 'Grundlagen',
  questionCount: '10',
  timeLimitMin: '30',
  passMarkPercent: '60',
  topicMix: {},
  reminderIntervalMin: '15',
}

describe('validateExamSetFields', () => {
  it('accepts valid settings and converts numbers', () => {
    expect(validateExamSetFields(base)).toEqual({
      ok: true,
      value: {
        name: 'Grundlagen',
        questionCount: 10,
        timeLimitMin: 30,
        passMarkPercent: 60,
        topicMix: {},
        reminderIntervalMin: 15,
      },
    })
  })

  it('no longer takes hold or attempt settings (they moved: no hold, attempts per curriculum)', () => {
    const r = validateExamSetFields({ ...base, holdResult: true, maxAttempts: '0' } as typeof base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).not.toHaveProperty('holdResult')
    expect(r.value).not.toHaveProperty('maxAttempts')
  })

  it('allows exams from 1 minute to 12 hours', () => {
    expect(validateExamSetFields({ ...base, timeLimitMin: 1 }).ok).toBe(true)
    expect(validateExamSetFields({ ...base, timeLimitMin: 480 }).ok).toBe(true)
    expect(validateExamSetFields({ ...base, timeLimitMin: 720 }).ok).toBe(true)
    expect(validateExamSetFields({ ...base, timeLimitMin: 721 })).toEqual({
      ok: false,
      errors: { timeLimitMin: 'Enter a duration from 1 min to 12 h' },
    })
    expect(validateExamSetFields({ ...base, timeLimitMin: 0 })).toMatchObject({ ok: false, errors: { timeLimitMin: expect.any(String) } })
  })

  it('reminder interval: 0 (off) or 1 to 120 minutes', () => {
    expect(validateExamSetFields({ ...base, reminderIntervalMin: 0 })).toMatchObject({ ok: true, value: { reminderIntervalMin: 0 } })
    expect(validateExamSetFields({ ...base, reminderIntervalMin: '120' }).ok).toBe(true)
    for (const bad of [121, -1, '1.5', 'x', '']) {
      expect(validateExamSetFields({ ...base, reminderIntervalMin: bad as never })).toEqual({
        ok: false,
        errors: { reminderIntervalMin: 'Enter 0 (no reminders) or a whole number of minutes from 1 to 120' },
      })
    }
  })

  it('a missing reminder interval means the default of 15 minutes', () => {
    const withoutReminder: Partial<typeof base> = { ...base }
    delete withoutReminder.reminderIntervalMin
    expect(validateExamSetFields(withoutReminder as Omit<typeof base, 'reminderIntervalMin'>)).toMatchObject({ ok: true, value: { reminderIntervalMin: 15 } })
  })

  it('rejects out-of-range numbers and a blank name, field by field', () => {
    const r = validateExamSetFields({
      ...base,
      name: ' ',
      questionCount: '0',
      timeLimitMin: '1.5',
      passMarkPercent: '101',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errors).sort()).toEqual(['name', 'passMarkPercent', 'questionCount', 'timeLimitMin'])
  })

  it('rejects a negative numeric pass mark', () => {
    const r = validateExamSetFields({ ...base, passMarkPercent: -1 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errors)).toEqual(['passMarkPercent'])
  })

  it('accepts pass mark 0 and 100', () => {
    expect(validateExamSetFields({ ...base, passMarkPercent: '0' }).ok).toBe(true)
    expect(validateExamSetFields({ ...base, passMarkPercent: 100 }).ok).toBe(true)
  })

  it('rejects a topic mix whose counts do not add up to the question count', () => {
    const r = validateExamSetFields({ ...base, topicMix: { Pflege: 4, Recht: 5 } })
    expect(r).toEqual({ ok: false, errors: { topicMix: 'Topic counts add up to 9, but the exam has 10 questions' } })
  })

  it('rejects negative, fractional or non-number counts and blank topics', () => {
    for (const topicMix of [{ a: -1, b: 11 }, { a: 2.5, b: 7.5 }, { a: '10' }, { ' ': 10 }, [10], null]) {
      const r = validateExamSetFields({ ...base, topicMix: topicMix as never })
      expect(r.ok).toBe(false)
    }
  })

  it('drops zero counts and trims topic names', () => {
    const r = validateExamSetFields({ ...base, topicMix: { ' Pflege ': 10, Recht: 0 } })
    expect(r).toMatchObject({ ok: true, value: { topicMix: { Pflege: 10 } } })
  })
})

describe('examSetSummary', () => {
  const settings = {
    questionCount: 30,
    timeLimitMin: 150,
    passMarkPercent: 60,
    reminderIntervalMin: 15,
  }

  it('says in one line what students will experience', () => {
    expect(examSetSummary(settings)).toBe(
      '30 questions, 2 h 30 min, pass at 60%, result shown at once, reminder every 15 min',
    )
  })

  it('singular counts, immediate results and reminders off', () => {
    expect(
      examSetSummary({ ...settings, questionCount: 1, timeLimitMin: 45, reminderIntervalMin: 0 }),
    ).toBe('1 question, 45 min, pass at 60%, result shown at once, no time reminders')
  })
})

describe('validateCurriculumFields', () => {
  it('accepts a name and attempts per student from 1 to 20', () => {
    expect(validateCurriculumFields({ name: ' Pflege ', maxAttempts: '3' })).toEqual({ ok: true, value: { name: 'Pflege', maxAttempts: 3 } })
    expect(validateCurriculumFields({ name: 'A', maxAttempts: 1 })).toMatchObject({ ok: true, value: { maxAttempts: 1 } })
    expect(validateCurriculumFields({ name: 'A', maxAttempts: 20 })).toMatchObject({ ok: true, value: { maxAttempts: 20 } })
  })

  it('a missing attempts value means the default of 2', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(2)
    expect(validateCurriculumFields({ name: 'A' })).toEqual({ ok: true, value: { name: 'A', maxAttempts: 2 } })
  })

  it('rejects attempts outside 1..20 and a blank or long name, field by field', () => {
    for (const bad of [0, 21, -1, '1.5', 'x', '']) {
      expect(validateCurriculumFields({ name: 'A', maxAttempts: bad as never })).toEqual({
        ok: false,
        errors: { maxAttempts: 'Enter a whole number from 1 to 20' },
      })
    }
    expect(validateCurriculumFields({ name: ' ', maxAttempts: 2 })).toEqual({ ok: false, errors: { name: 'Enter a name' } })
    expect(validateCurriculumFields({ name: 'x'.repeat(121), maxAttempts: 2 })).toEqual({
      ok: false,
      errors: { name: 'Use at most 120 characters' },
    })
  })
})

describe('parseTopicMixText', () => {
  it('reads one "topic: count" per line, blank text is no mix', () => {
    expect(parseTopicMixText('Pflege: 6\nRecht = 4\n\n')).toEqual({ ok: true, mix: { Pflege: 6, Recht: 4 } })
    expect(parseTopicMixText('  ')).toEqual({ ok: true, mix: {} })
  })

  it('keeps colons inside a topic name (the last separator counts)', () => {
    expect(parseTopicMixText('Teil 1: Pflege: 3')).toEqual({ ok: true, mix: { 'Teil 1: Pflege': 3 } })
  })

  it('reports a malformed or repeated line', () => {
    expect(parseTopicMixText('Pflege 6')).toEqual({ ok: false, message: 'Line 1: write "topic: count"' })
    expect(parseTopicMixText('Pflege: x')).toEqual({ ok: false, message: 'Line 1: write "topic: count"' })
    expect(parseTopicMixText('Pflege: 1\npflege: 2')).toEqual({ ok: true, mix: { Pflege: 1, pflege: 2 } })
    expect(parseTopicMixText('Pflege: 1\nPflege: 2')).toEqual({ ok: false, message: 'Line 2: topic "Pflege" is listed twice' })
  })

  it('keeps a topic named __proto__ as an own key', () => {
    const r = parseTopicMixText('__proto__: 10')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.hasOwn(r.mix, '__proto__')).toBe(true)
    expect(Object.entries(r.mix)).toEqual([['__proto__', 10]])
  })

  it('round-trips with formatTopicMix', () => {
    const mix = { Pflege: 6, Recht: 4 }
    expect(parseTopicMixText(formatTopicMix(mix))).toEqual({ ok: true, mix })
  })
})

describe('warnings', () => {
  const approved = [
    ...Array.from({ length: 5 }, () => ({ topic: 'Pflege' })),
    ...Array.from({ length: 2 }, () => ({ topic: 'Recht' })),
  ]

  it('warns only when there are fewer approved questions than one paper needs', () => {
    expect(poolWarning(4, 5)).toBe('Only 4 approved questions, but each paper needs 5. Students cannot get this exam set until more are approved.')
    expect(poolWarning(1, 2)).toBe('Only 1 approved question, but each paper needs 2. Students cannot get this exam set until more are approved.')
    expect(poolWarning(5, 5)).toBeNull()
    expect(poolWarning(7, 3)).toBeNull()
  })

  it('warns for topic mix topics with no approved question or too few', () => {
    const w = examSetWarnings({ questionCount: 3, topicMix: { Pflege: 1, Recht: 1, Ethik: 1 } }, approved)
    expect(w).toContain('Topic "Ethik" has no approved questions in this exam set.')
    expect(w).not.toContain(expect.stringContaining('"Pflege"'))
    expect(w.join(' ')).not.toMatch(/3 x|retake/i)
  })

  it('warns about the pool when the exam set cannot fill a paper', () => {
    expect(examSetWarnings({ questionCount: 8, topicMix: {} }, approved)).toEqual([
      'Only 7 approved questions, but each paper needs 8. Students cannot get this exam set until more are approved.',
    ])
  })

  it('warns when a topic has fewer approved questions than one paper needs', () => {
    const w = examSetWarnings({ questionCount: 5, topicMix: { Pflege: 2, Recht: 3 } }, approved)
    expect(w).toContain('Topic "Recht" has 2 approved questions, but each paper needs 3.')
  })

  it('no warnings for a big enough pool without a mix', () => {
    expect(examSetWarnings({ questionCount: 2, topicMix: {} }, approved)).toEqual([])
  })
})

describe('curriculumWarnings', () => {
  const set = (approved: number, questionCount = 2, topicMix: Record<string, number> = {}) => ({
    questionCount,
    topicMix,
    approvedTopics: Array.from({ length: approved }, () => 'Pflege'),
  })

  it('warns when fewer exam sets can fill a paper than students have attempts', () => {
    expect(curriculumWarnings({ maxAttempts: 2, examSets: [set(5)] })).toEqual([
      'Only 1 exam set can be given, but students get 2 attempts. Each attempt uses a different exam set, so students run out after 1. Add exam sets, or allow repeating exam sets for a student on the Extra attempts page.',
    ])
  })

  it('does not count exam sets without enough approved questions (count or topic mix)', () => {
    expect(curriculumWarnings({ maxAttempts: 2, examSets: [set(5), set(1), set(5, 2, { Recht: 2 })] })[0]).toMatch(/^Only 1 exam set can be given, but students get 2 attempts/)
    expect(curriculumWarnings({ maxAttempts: 1, examSets: [] })).toEqual([
      'No exam set can be given yet, but students get 1 attempt. Add an exam set with enough approved questions.',
    ])
  })

  it('no warning when there are enough exam sets', () => {
    expect(curriculumWarnings({ maxAttempts: 2, examSets: [set(5), set(2)] })).toEqual([])
    expect(curriculumWarnings({ maxAttempts: 1, examSets: [set(5)] })).toEqual([])
  })
})
