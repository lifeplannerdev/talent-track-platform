import { describe, expect, it } from 'vitest'
import { parseQuestionsCsv } from './questions'

const HEADER =
  'topic,difficulty,stem_de,stem_en,option_a_de,option_a_en,option_b_de,option_b_en,option_c_de,option_c_en,option_d_de,option_d_en,correct,points'

const row1 = 'Logik,easy,Frage eins,Question one,Ja,Yes,Nein,No,Vielleicht,Maybe,,,a,2'
const row2 = 'Logik,medium,Frage zwei,Question two,Eins,One,Zwei,Two,,,,,B,'
const row3 = 'Mathe,,Frage drei,Question three,A,A,B,B,C,C,D,D,d,1'

describe('parseQuestionsCsv', () => {
  it('returns 3 valid and 0 errors for a valid file', () => {
    const r = parseQuestionsCsv([HEADER, row1, row2, row3].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.valid).toHaveLength(3)
    expect(r.valid[0]).toEqual({
      topic: 'Logik',
      difficulty: 'easy',
      stemDe: 'Frage eins',
      stemEn: 'Question one',
      options: [
        { id: 'a', de: 'Ja', en: 'Yes' },
        { id: 'b', de: 'Nein', en: 'No' },
        { id: 'c', de: 'Vielleicht', en: 'Maybe' },
      ],
      correctOptionId: 'a',
      points: 2,
    })
    // blank points -> 1, upper-case correct normalised, two options only
    expect(r.valid[1].points).toBe(1)
    expect(r.valid[1].correctOptionId).toBe('b')
    expect(r.valid[1].options.map((o) => o.id)).toEqual(['a', 'b'])
    // blank difficulty -> medium
    expect(r.valid[2].difficulty).toBe('medium')
    expect(r.valid[2].options).toHaveLength(4)
  })

  it('strips a UTF-8 BOM so the first header is recognised', () => {
    const r = parseQuestionsCsv('\uFEFF' + [HEADER, row1].join('\r\n'))
    expect(r.errors).toEqual([])
    expect(r.valid).toHaveLength(1)
    expect(r.valid[0].topic).toBe('Logik')
  })

  it('keeps umlauts and sharp s intact', () => {
    const line = 'Größe,easy,Übung für Ärzte: Maß?,Exercise,öl,oil,ß,ss,,,,,a,1'
    const r = parseQuestionsCsv([HEADER, line].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.valid[0].topic).toBe('Größe')
    expect(r.valid[0].stemDe).toBe('Übung für Ärzte: Maß?')
    expect(r.valid[0].options[0].de).toBe('öl')
    expect(r.valid[0].options[1].de).toBe('ß')
  })

  it('skips blank rows without shifting row numbers of later errors', () => {
    const bad = 'Logik,easy,Frage vier,Question four,A,A,B,B,,,,,z,1'
    const r = parseQuestionsCsv([HEADER, row1, '', ',,,,,,,,,,,,,', bad].join('\n'))
    expect(r.valid).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
    // data rows: row1 = 1, blank = 2, blank = 3, bad = 4 (blank rows still count)
    expect(r.errors[0].row).toBe(4)
  })

  it('rejects correct outside a..d, naming the row', () => {
    const bad = 'Logik,easy,Frage vier,Question four,A,A,B,B,,,,,e,1'
    const r = parseQuestionsCsv([HEADER, row1, bad].join('\n'))
    expect(r.valid).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].row).toBe(2)
    expect(r.errors[0].message).toMatch(/correct/i)
  })

  it('rejects a correct option that is empty', () => {
    const bad = 'Logik,easy,Frage vier,Question four,A,A,B,B,,,,,c,1'
    const r = parseQuestionsCsv([HEADER, bad].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors[0].row).toBe(1)
    expect(r.errors[0].message).toMatch(/correct/i)
  })

  it('rejects missing English text for the stem', () => {
    const bad = 'Logik,easy,Frage vier,,A,A,B,B,,,,,a,1'
    const r = parseQuestionsCsv([HEADER, bad].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors[0].row).toBe(1)
    expect(r.errors[0].message).toMatch(/english/i)
  })

  it('rejects missing English text for a present option', () => {
    const bad = 'Logik,easy,Frage vier,Question,A,A,B,,,,,,a,1'
    const r = parseQuestionsCsv([HEADER, bad].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors[0].message).toMatch(/option b/i)
  })

  it('requires options a and b', () => {
    const bad = 'Logik,easy,Frage vier,Question,A,A,,,C,C,,,a,1'
    const r = parseQuestionsCsv([HEADER, bad].join('\n'))
    expect(r.valid).toEqual([])
    expect(r.errors[0].message).toMatch(/option b/i)
  })

  it('rejects invalid points', () => {
    const r = parseQuestionsCsv(
      [
        HEADER,
        'T,easy,F1,Q1,A,A,B,B,,,,,a,0',
        'T,easy,F2,Q2,A,A,B,B,,,,,a,1.5',
        'T,easy,F3,Q3,A,A,B,B,,,,,a,x',
      ].join('\n'),
    )
    expect(r.valid).toEqual([])
    expect(r.errors.map((e) => e.row)).toEqual([1, 2, 3])
    expect(r.errors.every((e) => /points/i.test(e.message))).toBe(true)
  })

  it('flags a duplicate stem_de on the later row only', () => {
    const dup = 'Logik,hard,Frage eins,Question uno,A,A,B,B,,,,,a,1'
    const r = parseQuestionsCsv([HEADER, row1, row2, dup].join('\n'))
    expect(r.valid).toHaveLength(2)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].row).toBe(3)
    expect(r.errors[0].message).toMatch(/duplicate/i)
  })

  it('auto-detects a semicolon-delimited file (German Excel)', () => {
    const semi = [HEADER, row1, row2]
      .map((l) => (l === HEADER ? l.replaceAll(',', ';') : l.replaceAll(',', ';')))
      .join('\r\n')
    const r = parseQuestionsCsv('\uFEFF' + semi)
    expect(r.errors).toEqual([])
    expect(r.valid).toHaveLength(2)
    expect(r.valid[0].stemDe).toBe('Frage eins')
  })

  it('reports a missing required column', () => {
    const r = parseQuestionsCsv('topic,stem_de\nLogik,Frage')
    expect(r.valid).toEqual([])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/column/i)
  })
})
