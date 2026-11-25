import { describe, expect, it } from "vitest"
import {
  adoptServerIds,
  checkRows,
  editorStateFromServer,
  isDirty,
  removeRow,
  rowsFromServer,
  sortRows,
  toggleMarker,
  type ChapterRow,
} from "./chapter-editor"

const ID1 = "11111111-1111-4111-8111-111111111111"
const ID2 = "22222222-2222-4222-8222-222222222222"

describe("chapter editor state", () => {
  it("adds a marker in start page order and removes it on a second click", () => {
    let state = toggleMarker({ rows: [], removed: [] }, 4, "k1")
    state = toggleMarker(state, 1, "k2")
    expect(state.rows.map((r) => r.startPage)).toEqual([1, 4])
    state = toggleMarker(state, 4, "k3")
    expect(state.rows.map((r) => r.startPage)).toEqual([1])
    expect(state.removed).toEqual([])
  })

  it("restores a removed saved chapter with its id and title when the marker goes back on its page", () => {
    let state = editorStateFromServer([{ id: ID1, title: "Eins", startPage: 1 }, { id: ID2, title: "Kapitel 3", startPage: 5 }])
    const initial = state.rows
    state = toggleMarker(state, 5, "k1")
    expect(state.rows.map((r) => r.id)).toEqual([ID1])
    expect(state.removed.map((r) => r.id)).toEqual([ID2])
    state = toggleMarker(state, 5, "k2")
    expect(state.rows.map((r) => [r.id, r.title, r.startPage])).toEqual([[ID1, "Eins", 1], [ID2, "Kapitel 3", 5]])
    expect(state.removed).toEqual([])
    expect(isDirty(initial, state.rows)).toBe(false)
  })

  it("restores through the Remove button too, and keeps the edited title", () => {
    let state = editorStateFromServer([{ id: ID1, title: "Eins", startPage: 1 }])
    state = { ...state, rows: state.rows.map((r) => ({ ...r, title: "Eins neu" })) }
    state = removeRow(state, ID1)
    expect(state.rows).toEqual([])
    state = toggleMarker(state, 1, "k1")
    expect(state.rows[0]).toMatchObject({ id: ID1, key: ID1, title: "Eins neu" })
  })

  it("makes a new row on a page nobody held, and forgets removed new rows", () => {
    let state = editorStateFromServer([{ id: ID1, title: "Eins", startPage: 1 }])
    state = toggleMarker(state, 3, "k1")
    expect(state.rows[1]).toEqual({ key: "k1", title: "", startPage: 3 })
    state = toggleMarker(state, 3, "k2")
    expect(state.removed).toEqual([])
    state = toggleMarker(state, 3, "k3")
    expect(state.rows[1].id).toBeUndefined()
  })

  it("does not bring a chapter back once the server's list replaced the editor state", () => {
    let state = editorStateFromServer([{ id: ID1, title: "Eins", startPage: 1 }, { id: ID2, title: "Zwei", startPage: 4 }])
    state = toggleMarker(state, 4, "k1")
    // Saved: the server returns only ID1, the editor state is rebuilt from it (the buffer is gone).
    state = editorStateFromServer([{ id: ID1, title: "Eins", startPage: 1 }])
    state = toggleMarker(state, 4, "k2")
    expect(state.rows[1].id).toBeUndefined()
  })

  it("keeps ids through a move and a rename", () => {
    const initial = rowsFromServer([{ id: ID1, title: "Eins", startPage: 1 }, { id: ID2, title: "Zwei", startPage: 4 }])
    const edited = initial.map((r) => (r.id === ID2 ? { ...r, startPage: 5, title: "Zwei neu" } : r))
    const checked = checkRows(edited, 6)
    expect(checked.ok && checked.chapters.map((c) => c.id)).toEqual([ID1, ID2])
    expect(checked.ok && checked.ranges.map((r) => [r.startPage, r.endPage])).toEqual([[1, 4], [5, 6]])
  })

  it("sends no id for a new row and reports the server's rules", () => {
    const rows: ChapterRow[] = [{ key: "a", title: "A", startPage: 1 }, { key: "b", title: "", startPage: 3 }]
    const checked = checkRows(rows, 6)
    expect(checked).toEqual({ ok: false, message: "Chapter 2 needs a title." })
    expect(checkRows([{ key: "a", title: "A", startPage: 2 }], 6)).toEqual({ ok: false, message: "The first chapter must start on page 1." })
    const ok = checkRows([{ key: "a", title: " A ", startPage: 1 }], 6)
    expect(ok.ok && ok.chapters).toEqual([{ title: "A", startPage: 1 }])
  })

  it("rejects an empty start page and an over-long title", () => {
    expect(checkRows([{ key: "a", title: "A", startPage: null }], 6)).toEqual({ ok: false, message: "Chapter 1 needs a start page." })
    const long = checkRows([{ key: "a", title: "x".repeat(121), startPage: 1 }], 6)
    expect(long.ok).toBe(false)
  })

  it("allows no chapters at all", () => {
    expect(checkRows([], 6)).toEqual({ ok: true, chapters: [], ranges: [] })
  })

  it("detects changes, ignoring order and surrounding spaces", () => {
    const initial = rowsFromServer([{ id: ID1, title: "Eins", startPage: 1 }])
    expect(isDirty(initial, initial.map((r) => ({ ...r, title: " Eins " })))).toBe(false)
    expect(isDirty(initial, initial.map((r) => ({ ...r, title: "Eins!" })))).toBe(true)
    expect(isDirty(initial, [])).toBe(true)
    expect(sortRows([{ key: "x", title: "", startPage: null }, { key: "y", title: "", startPage: 2 }])[0].key).toBe("y")
  })

  it("gives a new row the id the server assigned to the chapter on its page", () => {
    const rows: ChapterRow[] = [
      { key: "new-0", title: "A", startPage: 1 },
      { key: "new-1", title: "B edited", startPage: 5 },
    ]
    const adopted = adoptServerIds(rows, [
      { id: ID1, title: "A", startPage: 1 },
      { id: ID2, title: "B", startPage: 4 },
    ])
    expect(adopted[0]).toMatchObject({ id: ID1, key: ID1 })
    expect(adopted[1].id).toBeUndefined()
  })
})
