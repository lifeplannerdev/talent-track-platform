import { describe, expect, it } from 'vitest'
import { drawPaper, InsufficientPoolError } from './draw'
import type { Question } from './types'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function q(id: string, topic = 'anatomy', status: Question['status'] = 'approved'): Question {
  return {
    id,
    examSetId: 'set-1',
    topic,
    difficulty: '1',
    stemDe: `de ${id}`,
    stemEn: `en ${id}`,
    options: ['a', 'b', 'c', 'd'].map((o) => ({ id: o, de: o, en: o })),
    correctOptionId: 'a',
    points: 1,
    status,
  }
}

const pool = (n: number, topic = 'anatomy') =>
  Array.from({ length: n }, (_, i) => q(`${topic}-${i}`, topic))

describe('drawPaper', () => {
  it('returns exactly count unique questions', () => {
    const out = drawPaper({ pool: pool(20), seenIds: new Set(), count: 8, rng: mulberry32(1) })
    expect(out).toHaveLength(8)
    expect(new Set(out.map((d) => d.questionId)).size).toBe(8)
  })

  it('never returns an id in seenIds', () => {
    const seen = new Set(['anatomy-0', 'anatomy-1', 'anatomy-2'])
    const out = drawPaper({ pool: pool(10), seenIds: seen, count: 7, rng: mulberry32(2) })
    expect(out).toHaveLength(7)
    for (const d of out) expect(seen.has(d.questionId)).toBe(false)
  })

  it('honours topicMix', () => {
    const p = [...pool(10, 'anatomy'), ...pool(10, 'care')]
    const out = drawPaper({
      pool: p,
      seenIds: new Set(),
      count: 5,
      topicMix: { anatomy: 2, care: 3 },
      rng: mulberry32(3),
    })
    const topicOf = new Map(p.map((x) => [x.id, x.topic]))
    const counts = { anatomy: 0, care: 0 }
    for (const d of out) counts[topicOf.get(d.questionId) as 'anatomy' | 'care']++
    expect(counts).toEqual({ anatomy: 2, care: 3 })
  })

  it('gives different papers for different rng seeds', () => {
    const ids = (seed: number) =>
      drawPaper({ pool: pool(40), seenIds: new Set(), count: 10, rng: mulberry32(seed) })
        .map((d) => d.questionId)
        .join(',')
    expect(ids(1)).not.toBe(ids(2))
  })

  it('option order is a permutation of the question option ids', () => {
    const out = drawPaper({ pool: pool(10), seenIds: new Set(), count: 10, rng: mulberry32(4) })
    for (const d of out) {
      expect([...d.optionOrder].sort()).toEqual(['a', 'b', 'c', 'd'])
    }
  })

  it('never draws draft questions', () => {
    const p = [...pool(5), q('draft-1', 'anatomy', 'draft'), q('draft-2', 'anatomy', 'draft')]
    const out = drawPaper({ pool: p, seenIds: new Set(), count: 5, rng: mulberry32(5) })
    expect(out.map((d) => d.questionId).some((id) => id.startsWith('draft'))).toBe(false)
  })

  it('throws InsufficientPoolError with available and needed when the pool is short', () => {
    const p = [...pool(4), q('draft-1', 'anatomy', 'draft')]
    const seen = new Set(['anatomy-0'])
    try {
      drawPaper({ pool: p, seenIds: seen, count: 6, rng: mulberry32(6) })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientPoolError)
      expect((e as InsufficientPoolError).available).toBe(3)
      expect((e as InsufficientPoolError).needed).toBe(6)
    }
  })

  it('throws InsufficientPoolError for a short topic in topicMix', () => {
    const p = [...pool(10, 'anatomy'), ...pool(1, 'care')]
    try {
      drawPaper({
        pool: p,
        seenIds: new Set(),
        count: 4,
        topicMix: { anatomy: 2, care: 2 },
        rng: mulberry32(7),
      })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientPoolError)
      expect((e as InsufficientPoolError).available).toBe(1)
      expect((e as InsufficientPoolError).needed).toBe(2)
    }
  })

  it('throws when topicMix does not sum to count', () => {
    expect(() =>
      drawPaper({
        pool: pool(10),
        seenIds: new Set(),
        count: 5,
        topicMix: { anatomy: 2 },
        rng: mulberry32(8),
      }),
    ).toThrow(/topicMix/)
  })

  describe('allowSeen (staff allowed repeats)', () => {
    it('prefers unseen questions and fills only the shortfall with seen ones', () => {
      const seen = new Set(['anatomy-0', 'anatomy-1', 'anatomy-2', 'anatomy-3'])
      for (let seed = 1; seed <= 20; seed++) {
        const out = drawPaper({ pool: pool(6), seenIds: seen, count: 4, allowSeen: true, rng: mulberry32(seed) })
        const ids = out.map((d) => d.questionId)
        expect(new Set(ids).size).toBe(4)
        // Both unseen questions are always in, plus exactly two seen ones.
        expect(ids).toEqual(expect.arrayContaining(['anatomy-4', 'anatomy-5']))
        expect(ids.filter((id) => seen.has(id))).toHaveLength(2)
      }
    })

    it('takes only unseen questions when there are enough', () => {
      const seen = new Set(['anatomy-0', 'anatomy-1'])
      const out = drawPaper({ pool: pool(8), seenIds: seen, count: 5, allowSeen: true, rng: mulberry32(11) })
      for (const d of out) expect(seen.has(d.questionId)).toBe(false)
    })

    it('fills per topic in a topic mix', () => {
      const p = [...pool(3, 'anatomy'), ...pool(3, 'care')]
      const seen = new Set(['anatomy-0', 'anatomy-1', 'care-0'])
      const out = drawPaper({ pool: p, seenIds: seen, count: 5, topicMix: { anatomy: 2, care: 3 }, allowSeen: true, rng: mulberry32(12) })
      const ids = out.map((d) => d.questionId)
      expect(ids).toEqual(expect.arrayContaining(['anatomy-2', 'care-0', 'care-1', 'care-2']))
      expect(ids.filter((id) => id.startsWith('anatomy'))).toHaveLength(2)
    })

    it('still throws when even seen and unseen together are too few (drafts never count)', () => {
      const p = [...pool(3), q('draft-1', 'anatomy', 'draft')]
      expect(() =>
        drawPaper({ pool: p, seenIds: new Set(['anatomy-0']), count: 4, allowSeen: true, rng: mulberry32(13) }),
      ).toThrow(InsufficientPoolError)
    })
  })

  it('does not mutate its inputs', () => {
    const p = pool(10)
    const snapshot = JSON.stringify(p)
    const seen = new Set(['anatomy-0'])
    drawPaper({ pool: p, seenIds: seen, count: 5, rng: mulberry32(9) })
    expect(JSON.stringify(p)).toBe(snapshot)
    expect([...seen]).toEqual(['anatomy-0'])
  })
})
