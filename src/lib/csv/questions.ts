import Papa from 'papaparse'
import type { NewQuestion, QuestionOption } from '../types'

export type QuestionCsvError = { row: number; message: string }

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const

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
export function parseQuestionsCsv(text: string): {
  valid: NewQuestion[]
  errors: QuestionCsvError[]
} {
  const valid: NewQuestion[] = []
  const errors: QuestionCsvError[] = []

  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    // Blank rows are skipped below so that row numbers stay positional.
    skipEmptyLines: false,
    // Delimiter is auto-detected; German-locale Excel writes semicolons.
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim().toLowerCase(),
    transform: (v) => v.trim(),
  })

  const fields = parsed.meta.fields ?? []
  const missing = REQUIRED_COLUMNS.filter((c) => !fields.includes(c))
  if (missing.length > 0) {
    return {
      valid,
      errors: [{ row: 0, message: `Missing required column(s): ${missing.join(', ')}` }],
    }
  }

  // Only malformed quoting is a real problem; field-count mismatches on blank
  // or short rows are handled by the per-row validation.
  for (const e of parsed.errors) {
    if (e.type === 'Quotes' && typeof e.row === 'number') {
      errors.push({ row: e.row + 1, message: `Malformed quoting: ${e.message}` })
    }
  }

  const seenStems = new Set<string>()

  parsed.data.forEach((raw, index) => {
    const row = index + 1
    const cell = (key: string) => (raw[key] ?? '').trim()

    if (Object.values(raw).every((v) => !v || !String(v).trim())) return

    const fail = (message: string) => {
      errors.push({ row, message })
    }

    const stemDe = cell('stem_de')
    const stemEn = cell('stem_en')
    if (!cell('topic')) return fail('Missing topic')
    if (!stemDe) return fail('Missing German question text (stem_de)')
    if (!stemEn) return fail('Missing English question text (stem_en)')

    const options: QuestionOption[] = []
    for (const id of OPTION_IDS) {
      const de = cell(`option_${id}_de`)
      const en = cell(`option_${id}_en`)
      if (!de && !en) {
        if (id === 'a' || id === 'b') return fail(`Option ${id.toUpperCase()} is required`)
        continue
      }
      if (!de) return fail(`Option ${id.toUpperCase()} is missing German text (option_${id}_de)`)
      if (!en) return fail(`Option ${id.toUpperCase()} is missing English text (option_${id}_en)`)
      options.push({ id, de, en })
    }

    const correct = cell('correct').toLowerCase()
    if (!(OPTION_IDS as readonly string[]).includes(correct)) {
      return fail(`Invalid correct option "${cell('correct')}" (must be one of a, b, c, d)`)
    }
    if (!options.some((o) => o.id === correct)) {
      return fail(`Correct option "${correct}" has no text`)
    }

    const pointsRaw = cell('points')
    let points = 1
    if (pointsRaw) {
      if (!/^\d+$/.test(pointsRaw) || Number(pointsRaw) < 1) {
        return fail(`Invalid points "${pointsRaw}" (must be a positive integer)`)
      }
      points = Number(pointsRaw)
    }

    if (seenStems.has(stemDe)) return fail(`Duplicate German question text: "${stemDe}"`)
    seenStems.add(stemDe)

    valid.push({
      topic: cell('topic'),
      difficulty: cell('difficulty') || 'medium',
      stemDe,
      stemEn,
      options,
      correctOptionId: correct,
      points,
    })
  })

  return { valid, errors }
}
