import { describe, expect, it } from 'vitest'
import { validateQuestionFields, type QuestionFields } from './question-fields'

const fields: QuestionFields = {
  topic: 'Pflege',
  difficulty: '',
  stemDe: 'Wie heißt die Hauptstadt?',
  stemEn: 'What is the capital?',
  options: {
    a: { de: 'Berlin', en: 'Berlin' },
    b: { de: 'München', en: 'Munich' },
    c: { de: '', en: '' },
    d: { de: '', en: '' },
  },
  correct: 'A',
  points: '',
}

describe('validateQuestionFields (shared by the CSV import and the manual form)', () => {
  it('normalises a valid question', () => {
    expect(validateQuestionFields(fields)).toEqual({
      ok: true,
      question: {
        topic: 'Pflege',
        difficulty: 'medium',
        stemDe: 'Wie heißt die Hauptstadt?',
        stemEn: 'What is the capital?',
        options: [
          { id: 'a', de: 'Berlin', en: 'Berlin' },
          { id: 'b', de: 'München', en: 'Munich' },
        ],
        correctOptionId: 'a',
        points: 1,
      },
    })
  })

  it('rejects a missing translation, a correct option without text and bad points', () => {
    expect(validateQuestionFields({ ...fields, stemEn: ' ' })).toEqual({ ok: false, message: 'Missing English question text (stem_en)' })
    expect(validateQuestionFields({ ...fields, options: { ...fields.options, c: { de: 'Hamburg', en: '' } } })).toEqual({
      ok: false,
      message: 'Option C is missing English text (option_c_en)',
    })
    expect(validateQuestionFields({ ...fields, correct: 'd' })).toEqual({ ok: false, message: 'Correct option "d" has no text' })
    expect(validateQuestionFields({ ...fields, points: '0' })).toEqual({
      ok: false,
      message: 'Invalid points "0" (must be a positive integer)',
    })
  })
})
