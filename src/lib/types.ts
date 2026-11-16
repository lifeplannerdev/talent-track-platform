export type QuestionStatus = 'draft' | 'approved'
export type QuestionOption = { id: string; de: string; en: string }

// Mirrors public.questions. The schema stores difficulty as unconstrained text,
// so it is a string here too.
export type Question = {
  id: string
  examSetId: string
  topic: string
  difficulty: string
  stemDe: string
  stemEn: string
  options: QuestionOption[]
  correctOptionId: string
  points: number
  status: QuestionStatus
}

export type NewQuestion = Omit<Question, 'id' | 'examSetId' | 'status'>
