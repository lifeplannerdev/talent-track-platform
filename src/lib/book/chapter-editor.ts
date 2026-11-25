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

/**
 * The editor's working state: the rows, plus the saved chapters (rows with an id) the admin removed
 * since the last save. A removed row is kept here so putting a marker back on the page it held
 * restores the same chapter (id and title) instead of making a new one: the server retires an
 * omitted id for good, so an accidental click and its undo must not swap the chapter's id.
 */
export type EditorState = { rows: ChapterRow[]; removed: ChapterRow[] }

export const editorStateFromServer = (chapters: { id: string; title: string; startPage: number }[]): EditorState => ({
  rows: rowsFromServer(chapters),
  removed: [],
})

/** Takes a row out. A saved row (it has an id) is remembered for a restore; a new row is just dropped. */
export function removeRow(state: EditorState, key: string): EditorState {
  const row = state.rows.find((r) => r.key === key)
  if (!row) return state
  const removed = row.id ? [...state.removed.filter((r) => r.id !== row.id), row] : state.removed
  return { rows: state.rows.filter((r) => r.key !== key), removed }
}

/**
 * Clicking a page: a chapter starts there or, when one already does, it is removed. A marker put
 * back on the page of a removed saved chapter brings that chapter back with its id and title.
 */
export function toggleMarker(state: EditorState, page: number, newKey: string): EditorState {
  const existing = state.rows.find((r) => r.startPage === page)
  if (existing) return removeRow(state, existing.key)
  const back = [...state.removed].reverse().find((r) => r.startPage === page)
  if (back) return { rows: sortRows([...state.rows, back]), removed: state.removed.filter((r) => r.id !== back.id) }
  return { rows: sortRows([...state.rows, { key: newKey, title: "", startPage: page }]), removed: state.removed }
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
