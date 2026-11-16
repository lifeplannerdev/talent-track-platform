import type { NewQuestion } from '../types'
import { OPTION_IDS, validateQuestionFields } from '../question-fields'
import { readCsvRows, type CsvError } from './rows'

export type QuestionCsvError = CsvError

const REQUIRED_COLUMNS = [
  'topic',
  'difficulty',
  'stem_de',
  'stem_en',
  ...OPTION_IDS.flatMap((id) => [`option_${id}_de`, `option_${id}_en`]),
  'correct',
  'points',
]

// Row numbers are 1-based data rows: the header is not counted, and blank rows
// still count (so the number matches the data row position in the file).
// The per-question rules are shared with the manual form (validateQuestionFields).
export function parseQuestionsCsv(text: string): {
  valid: NewQuestion[]
  errors: QuestionCsvError[]
} {
  const valid: NewQuestion[] = []
  const { rows, errors } = readCsvRows(text, REQUIRED_COLUMNS)
  const seenStems = new Set<string>()

  for (const { row, cell } of rows) {
    const result = validateQuestionFields({
      topic: cell('topic'),
      difficulty: cell('difficulty'),
      stemDe: cell('stem_de'),
      stemEn: cell('stem_en'),
      options: {
        a: { de: cell('option_a_de'), en: cell('option_a_en') },
        b: { de: cell('option_b_de'), en: cell('option_b_en') },
        c: { de: cell('option_c_de'), en: cell('option_c_en') },
        d: { de: cell('option_d_de'), en: cell('option_d_en') },
      },
      correct: cell('correct'),
      points: cell('points'),
    })
    if (!result.ok) {
      errors.push({ row, message: result.message })
      continue
    }
    const { stemDe } = result.question
    if (seenStems.has(stemDe)) {
      errors.push({ row, message: `Duplicate German question text: "${stemDe}"` })
      continue
    }
    seenStems.add(stemDe)
    valid.push(result.question)
  }

  return { valid, errors }
}
