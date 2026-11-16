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

export function drawPaper({ pool, seenIds, count, topicMix, rng }: DrawInput): DrawnQuestion[] {
  const eligible = pool.filter((x) => x.status === 'approved' && !seenIds.has(x.id))

  let picked: Question[]
  if (topicMix) {
    const total = Object.values(topicMix).reduce((s, n) => s + n, 0)
    if (total !== count) {
      throw new Error(`topicMix counts sum to ${total} but count is ${count}`)
    }
    picked = []
    for (const [topic, need] of Object.entries(topicMix)) {
      const ofTopic = eligible.filter((x) => x.topic === topic)
      if (ofTopic.length < need) throw new InsufficientPoolError(ofTopic.length, need, topic)
      picked.push(...shuffle(ofTopic, rng).slice(0, need))
    }
  } else {
    if (eligible.length < count) throw new InsufficientPoolError(eligible.length, count)
    picked = shuffle(eligible, rng).slice(0, count)
  }

  return shuffle(picked, rng).map((x) => ({
    questionId: x.id,
    optionOrder: shuffle(
      x.options.map((o) => o.id),
      rng,
    ),
  }))
}
