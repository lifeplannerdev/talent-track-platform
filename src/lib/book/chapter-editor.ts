// Pure state helpers for the staff chapter editor (client and test safe).
// A row is one chapter marker. Rows that came from the server keep their id for good: moving a
// marker or renaming a chapter never changes it, and removing a row simply leaves it out of the
// next save (the server retires it, history is permanent).

import { chapterRanges, validateChapters, type ChapterInput, type ChapterRange } from "./chapters"

export type ChapterRow = { key: string; id?: string; title: string; startPage: number | null }

const sortKey = (r: ChapterRow) => r.startPage ?? Number.POSITIVE_INFINITY

/** Stable sort by start page (a row without a start page goes last). */
export function sortRows(rows: ChapterRow[]): ChapterRow[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => sortKey(a.r) - sortKey(b.r) || a.i - b.i).map((x) => x.r)
}

export function rowsFromServer(chapters: { id: string; title: string; startPage: number }[]): ChapterRow[] {
  return sortRows(chapters.map((c) => ({ key: c.id, id: c.id, title: c.title, startPage: c.startPage })))
}

/** Clicking a page: a chapter starts there (new row) or, when one already does, it is removed. */
export function toggleMarker(rows: ChapterRow[], page: number, newKey: string): ChapterRow[] {
  if (rows.some((r) => r.startPage === page)) return rows.filter((r) => r.startPage !== page)
  return sortRows([...rows, { key: newKey, title: "", startPage: page }])
}

export type RowsCheck =
  | { ok: true; chapters: ChapterInput[]; ranges: ChapterRange[] }
  | { ok: false; message: string }

/** Validates the rows with the same rules as the server. Rows are checked in start page order. */
export function checkRows(rows: ChapterRow[], pageCount: number): RowsCheck {
  const sorted = sortRows(rows)
  const missing = sorted.findIndex((r) => r.startPage === null || !Number.isFinite(r.startPage))
  if (missing >= 0) return { ok: false, message: `Chapter ${missing + 1} needs a start page.` }
  const inputs: ChapterInput[] = sorted.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    title: r.title,
    startPage: r.startPage as number,
  }))
  const checked = validateChapters(inputs, pageCount)
  if (!checked.ok) return checked
  return { ok: true, chapters: checked.chapters, ranges: chapterRanges(checked.chapters, pageCount) }
}

const signature = (rows: ChapterRow[]) =>
  JSON.stringify(sortRows(rows).map((r) => [r.id ?? null, r.title.trim(), r.startPage]))

export function isDirty(initial: ChapterRow[], rows: ChapterRow[]): boolean {
  return signature(initial) !== signature(rows)
}

/**
 * Keeps the editor's unsaved edits when the server's chapters arrive after a save: a row that has
 * no id yet but starts on the page of a server chapter is that chapter, so it takes its id (and
 * key). Existing ids never change.
 */
export function adoptServerIds(
  rows: ChapterRow[],
  server: { id: string; title: string; startPage: number }[],
): ChapterRow[] {
  const taken = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))
  return rows.map((r) => {
    if (r.id || r.startPage === null) return r
    const match = server.find((c) => c.startPage === r.startPage && !taken.has(c.id))
    if (!match) return r
    taken.add(match.id)
    return { ...r, id: match.id, key: match.id }
  })
}
