import type { NewQuestion, QuestionOption } from './types'

// One validation for questions, shared by the CSV import (parseQuestionsCsv) and the manual
// staff form (saveQuestion), so both paths accept exactly the same questions.

export const OPTION_IDS = ['a', 'b', 'c', 'd'] as const
export type OptionId = (typeof OPTION_IDS)[number]

export type QuestionFields = {
  topic: string
  difficulty: string
  stemDe: string
  stemEn: string
  /** German and English text per option id; options c and d may be blank. */
  options: Record<OptionId, { de: string; en: string }>
  correct: string
  /** Raw points text; blank means 1. */
  points: string
}

export type QuestionFieldsResult = { ok: true; question: NewQuestion } | { ok: false; message: string }

export function validateQuestionFields(fields: QuestionFields): QuestionFieldsResult {
  const fail = (message: string): QuestionFieldsResult => ({ ok: false, message })
  const topic = fields.topic.trim()
  const stemDe = fields.stemDe.trim()
  const stemEn = fields.stemEn.trim()
  if (!topic) return fail('Missing topic')
  if (!stemDe) return fail('Missing German question text (stem_de)')
  if (!stemEn) return fail('Missing English question text (stem_en)')

  const options: QuestionOption[] = []
  for (const id of OPTION_IDS) {
    const de = (fields.options[id]?.de ?? '').trim()
    const en = (fields.options[id]?.en ?? '').trim()
    if (!de && !en) {
      if (id === 'a' || id === 'b') return fail(`Option ${id.toUpperCase()} is required`)
      continue
    }
    if (!de) return fail(`Option ${id.toUpperCase()} is missing German text (option_${id}_de)`)
    if (!en) return fail(`Option ${id.toUpperCase()} is missing English text (option_${id}_en)`)
    options.push({ id, de, en })
  }

  const correctRaw = fields.correct.trim()
  const correct = correctRaw.toLowerCase()
  if (!(OPTION_IDS as readonly string[]).includes(correct)) {
    return fail(`Invalid correct option "${correctRaw}" (must be one of a, b, c, d)`)
  }
  if (!options.some((o) => o.id === correct)) return fail(`Correct option "${correct}" has no text`)

  const pointsRaw = fields.points.trim()
  let points = 1
  if (pointsRaw) {
    if (!/^\d+$/.test(pointsRaw) || !Number.isSafeInteger(Number(pointsRaw)) || Number(pointsRaw) < 1) {
      return fail(`Invalid points "${pointsRaw}" (must be a positive integer)`)
    }
    points = Number(pointsRaw)
  }

  return {
    ok: true,
    question: {
      topic,
      difficulty: fields.difficulty.trim() || 'medium',
      stemDe,
      stemEn,
      options,
      correctOptionId: correct,
      points,
    },
  }
}
