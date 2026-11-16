import { describe, expect, it } from 'vitest'
import { examSetWarnings, formatTopicMix, parseTopicMixText, poolWarning, validateExamSetFields } from './exam-set-fields'

const base = {
  name: 'Grundlagen',
  questionCount: '10',
  timeLimitMin: '30',
  passMarkPercent: '60',
  maxAttempts: '2',
  holdResult: true,
  topicMix: {},
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
        maxAttempts: 2,
        holdResult: true,
        topicMix: {},
      },
    })
  })

  it('rejects out-of-range numbers and a blank name, field by field', () => {
    const r = validateExamSetFields({
      ...base,
      name: ' ',
      questionCount: '0',
      timeLimitMin: '1.5',
      passMarkPercent: '101',
      maxAttempts: '0',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errors).sort()).toEqual(['maxAttempts', 'name', 'passMarkPercent', 'questionCount', 'timeLimitMin'])
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

  it('warns when the pool is smaller than 3 x question count', () => {
    expect(poolWarning(7, 3)).toBe('Only 7 approved questions; at least 9 (3 x 3) are recommended so retakes get unseen questions.')
    expect(poolWarning(9, 3)).toBeNull()
  })

  it('warns for topic mix topics with no approved question or too few', () => {
    const w = examSetWarnings({ questionCount: 3, topicMix: { Pflege: 1, Recht: 1, Ethik: 1 } }, approved)
    expect(w).toContain('Topic "Ethik" has no approved questions in this exam set.')
    expect(w).not.toContain(expect.stringContaining('"Pflege"'))
    expect(w).toContain('Only 7 approved questions; at least 9 (3 x 3) are recommended so retakes get unseen questions.')
  })

  it('warns when a topic has fewer approved questions than one paper needs', () => {
    const w = examSetWarnings({ questionCount: 5, topicMix: { Pflege: 2, Recht: 3 } }, approved)
    expect(w).toContain('Topic "Recht" has 2 approved questions, but each paper needs 3.')
  })

  it('no warnings for a big enough pool without a mix', () => {
    expect(examSetWarnings({ questionCount: 2, topicMix: {} }, approved)).toEqual([])
  })
})
