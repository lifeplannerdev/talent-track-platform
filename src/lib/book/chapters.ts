// Chapter rules for a curriculum book (pure: safe for client and server code).
// The same rules are enforced in SQL by public.save_chapters (migration 0028).

export const MAX_CHAPTER_TITLE_LENGTH = 120

export type ChapterInput = { id?: string; title: string; startPage: number }

export type ChapterRange = {
  id?: string
  index: number
  title: string
  startPage: number
  endPage: number
  pageCount: number
}

export type ChapterValidation =
  | { ok: true; chapters: ChapterInput[] }
  | { ok: false; message: string }

const fail = (message: string): ChapterValidation => ({ ok: false, message })

// Input order must already be by start page; nothing is sorted here.
export function validateChapters(chapters: ChapterInput[], pageCount: number): ChapterValidation {
  if (chapters.length === 0) return { ok: true, chapters: [] }
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return fail('The book needs at least one page before it can have chapters.')
  }

  const seenIds = new Set<string>()
  const out: ChapterInput[] = []
  let previous = 0

  for (let i = 0; i < chapters.length; i++) {
    const n = i + 1
    const c = chapters[i]
    const title = c.title.trim()
    if (title.length === 0) return fail(`Chapter ${n} needs a title.`)
    if (title.length > MAX_CHAPTER_TITLE_LENGTH) {
      return fail(`Chapter ${n}: the title can be at most ${MAX_CHAPTER_TITLE_LENGTH} characters.`)
    }
    if (!Number.isInteger(c.startPage)) {
      return fail(`Chapter ${n}: the start page must be a whole number.`)
    }
    if (c.startPage < 1 || c.startPage > pageCount) {
      return fail(`Chapter ${n}: the start page must be between 1 and ${pageCount}.`)
    }
    if (i === 0 && c.startPage !== 1) {
      return fail('The first chapter must start on page 1.')
    }
    if (c.startPage <= previous) {
      return fail(`Chapter ${n} must start on a later page than the chapter before it.`)
    }
    previous = c.startPage

    if (c.id !== undefined) {
      const key = c.id.toLowerCase()
      if (seenIds.has(key)) return fail(`Chapter ${n} is the same chapter as an earlier one.`)
      seenIds.add(key)
      out.push({ id: c.id, title, startPage: c.startPage })
    } else {
      out.push({ title, startPage: c.startPage })
    }
  }

  return { ok: true, chapters: out }
}

// Each chapter runs from its start page to the page before the next start (the last one to the end).
export function chapterRanges(chapters: ChapterInput[], pageCount: number): ChapterRange[] {
  return chapters.map((c, index) => {
    const next = chapters[index + 1]
    const endPage = next ? next.startPage - 1 : pageCount
    const range: ChapterRange = {
      index,
      title: c.title,
      startPage: c.startPage,
      endPage,
      pageCount: endPage - c.startPage + 1,
    }
    if (c.id !== undefined) range.id = c.id
    return range
  })
}

export function chapterOfPage(ranges: ChapterRange[], page: number): ChapterRange | null {
  return ranges.find((r) => page >= r.startPage && page <= r.endPage) ?? null
}
