import type { Question } from './types'

export class InsufficientPoolError extends Error {
  available: number
  needed: number
  constructor(available: number, needed: number, topic?: string) {
    super(
      `Not enough unseen approved questions${topic ? ` for topic "${topic}"` : ''}: ` +
        `${available} available, ${needed} needed`,
    )
    this.name = 'InsufficientPoolError'
    this.available = available
    this.needed = needed
  }
}

export type DrawInput = {
  pool: Question[]
  seenIds: Set<string>
  count: number
  topicMix?: Record<string, number>
  /**
   * Staff allowed repeats: unseen questions still come first, and only the shortfall is filled
   * with questions in seenIds (per topic with a topic mix). Without it seen questions never appear.
   */
  allowSeen?: boolean
  rng: () => number
}

export type DrawnQuestion = { questionId: string; optionOrder: string[] }

// Fisher-Yates on a copy; rng returns [0,1).
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function drawPaper({ pool, seenIds, count, topicMix, allowSeen = false, rng }: DrawInput): DrawnQuestion[] {
  const approved = pool.filter((x) => x.status === 'approved')

  // need questions from candidates: unseen first (shuffled), then seen ones if allowed.
  const take = (candidates: Question[], need: number, topic?: string): Question[] => {
    const unseen = shuffle(
      candidates.filter((x) => !seenIds.has(x.id)),
      rng,
    )
    const seen = allowSeen ? shuffle(candidates.filter((x) => seenIds.has(x.id)), rng) : []
    const ordered = [...unseen, ...seen]
    if (ordered.length < need) throw new InsufficientPoolError(ordered.length, need, topic)
    return ordered.slice(0, need)
  }

  let picked: Question[]
  if (topicMix) {
    const total = Object.values(topicMix).reduce((s, n) => s + n, 0)
    if (total !== count) {
      throw new Error(`topicMix counts sum to ${total} but count is ${count}`)
    }
    picked = []
    for (const [topic, need] of Object.entries(topicMix)) {
      picked.push(...take(approved.filter((x) => x.topic === topic), need, topic))
    }
  } else {
    picked = take(approved, count)
  }

  return shuffle(picked, rng).map((x) => ({
    questionId: x.id,
    optionOrder: shuffle(
      x.options.map((o) => o.id),
      rng,
    ),
  }))
}
