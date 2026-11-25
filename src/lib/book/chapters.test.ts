import { describe, expect, it } from 'vitest'
import {
  chapterOfPage,
  chapterRanges,
  MAX_CHAPTER_TITLE_LENGTH,
  validateChapters,
  type ChapterInput,
} from './chapters'

const three: ChapterInput[] = [
  { title: 'Basics', startPage: 1 },
  { title: 'Nursing care', startPage: 12 },
  { title: 'Law', startPage: 30 },
]

function message(chapters: ChapterInput[], pageCount: number): string {
  const r = validateChapters(chapters, pageCount)
  if (r.ok) throw new Error('expected failure')
  return r.message
}

describe('validateChapters', () => {
  it('accepts a valid 3-chapter file and trims titles', () => {
    const r = validateChapters(
      [{ title: '  Basics ', startPage: 1 }, ...three.slice(1)],
      51,
    )
    expect(r).toEqual({
      ok: true,
      chapters: [{ title: 'Basics', startPage: 1 }, three[1], three[2]],
    })
  })

  it('accepts zero chapters (a draft)', () => {
    expect(validateChapters([], 10)).toEqual({ ok: true, chapters: [] })
  })

  it('requires the first chapter to start on page 1', () => {
    expect(message([{ title: 'A', startPage: 2 }], 10)).toMatch(/page 1/)
  })

  it('rejects duplicate and descending starts', () => {
    const dup = [three[0], { title: 'B', startPage: 1 }]
    expect(message(dup, 10)).toMatch(/later page/i)
    const desc = [three[0], three[2], three[1]]
    expect(message(desc, 51)).toMatch(/later page/i)
  })

  it('rejects start 0, a start past the last page and non-integers', () => {
    expect(message([{ title: 'A', startPage: 0 }], 10)).toMatch(/page/)
    expect(message([three[0], { title: 'B', startPage: 11 }], 10)).toMatch(/10/)
    expect(message([{ title: 'A', startPage: 1.5 }], 10)).toMatch(/whole/)
    expect(message([{ title: 'A', startPage: Number.NaN }], 10)).toMatch(/whole/)
  })

  it('rejects empty and whitespace titles', () => {
    expect(message([{ title: '', startPage: 1 }], 10)).toMatch(/title/i)
    expect(message([{ title: '   ', startPage: 1 }], 10)).toMatch(/title/i)
  })

  it('limits titles to 120 characters after trimming', () => {
    expect(MAX_CHAPTER_TITLE_LENGTH).toBe(120)
    const ok = 'a'.repeat(120)
    expect(validateChapters([{ title: ` ${ok} `, startPage: 1 }], 10).ok).toBe(true)
    expect(message([{ title: 'a'.repeat(121), startPage: 1 }], 10)).toMatch(/120/)
  })

  it('passes ids through unchanged', () => {
    const id = '3f2b8c1e-0000-4000-8000-000000000001'
    const r = validateChapters([{ id, title: 'A', startPage: 1 }, { title: 'B', startPage: 5 }], 10)
    expect(r).toEqual({
      ok: true,
      chapters: [{ id, title: 'A', startPage: 1 }, { title: 'B', startPage: 5 }],
    })
  })

  it('rejects a repeated id, ignoring case', () => {
    const id = '3f2b8c1e-0000-4000-8000-00000000000a'
    const dup = [
      { id, title: 'A', startPage: 1 },
      { id: id.toUpperCase(), title: 'B', startPage: 5 },
    ]
    expect(message(dup, 10)).toMatch(/same chapter/i)
  })

  it('rejects a page count that is not a positive whole number when chapters exist', () => {
    expect(message([three[0]], 0)).toMatch(/page/)
  })
})

describe('chapterRanges', () => {
  it('returns [] for no chapters', () => {
    expect(chapterRanges([], 10)).toEqual([])
  })

  it('covers 51 pages with starts 1, 12, 30', () => {
    expect(chapterRanges(three, 51)).toEqual([
      { index: 0, title: 'Basics', startPage: 1, endPage: 11, pageCount: 11 },
      { index: 1, title: 'Nursing care', startPage: 12, endPage: 29, pageCount: 18 },
      { index: 2, title: 'Law', startPage: 30, endPage: 51, pageCount: 22 },
    ])
  })

  it('carries ids through in the given order', () => {
    const r = chapterRanges([{ id: 'x', title: 'A', startPage: 1 }, { title: 'B', startPage: 3 }], 5)
    expect(r[0].id).toBe('x')
    expect('id' in r[1]).toBe(false)
  })
})

describe('chapterOfPage', () => {
  const ranges = chapterRanges(three, 51)

  it('finds the chapter at boundaries', () => {
    expect(chapterOfPage(ranges, 1)?.index).toBe(0)
    expect(chapterOfPage(ranges, 11)?.index).toBe(0)
    expect(chapterOfPage(ranges, 12)?.index).toBe(1)
    expect(chapterOfPage(ranges, 29)?.index).toBe(1)
    expect(chapterOfPage(ranges, 30)?.index).toBe(2)
    expect(chapterOfPage(ranges, 51)?.index).toBe(2)
  })

  it('returns null out of range or with no ranges', () => {
    expect(chapterOfPage(ranges, 0)).toBeNull()
    expect(chapterOfPage(ranges, 52)).toBeNull()
    expect(chapterOfPage([], 1)).toBeNull()
  })
})
