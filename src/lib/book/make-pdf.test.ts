import { describe, expect, it } from "vitest"
import { makePdf } from "../../../e2e/fixtures/make-pdf"

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes)

describe("makePdf", () => {
  it("is deterministic and framed as a PDF", () => {
    const a = makePdf(3)
    expect(a).toEqual(makePdf(3))
    const s = text(a)
    expect(s.startsWith("%PDF-")).toBe(true)
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true)
  })

  it("declares the page count", () => {
    expect(text(makePdf(7))).toMatch(/\/Count 7\b/)
    expect(text(makePdf(1))).toMatch(/\/Count 1\b/)
  })

  it("has an xref table whose offsets point at their objects", () => {
    const s = text(makePdf(5))
    const start = Number(/startxref\s+(\d+)/.exec(s)![1])
    expect(s.slice(start, start + 4)).toBe("xref")
    const m = /xref\n0 (\d+)\n/.exec(s.slice(start))!
    const count = Number(m[1])
    const first = start + m[0].length
    for (let i = 1; i < count; i++) {
      const entry = s.slice(first + i * 20, first + i * 20 + 20)
      expect(entry).toMatch(/^\d{10} 00000 n \r?\n$|^\d{10} 00000 n \n$/)
      const offset = Number(entry.slice(0, 10))
      expect(s.slice(offset).startsWith(`${i} 0 obj`)).toBe(true)
    }
    expect(s.slice(first, first + 20)).toMatch(/^0000000000 65535 f/)
  })

  it("gives every page a visible text line and a coloured rectangle", () => {
    const s = text(makePdf(4))
    for (let n = 1; n <= 4; n++) expect(s).toContain(`(Page ${n}) Tj`)
    expect((s.match(/ rg\n/g) ?? []).length).toBe(4)
  })

  it("is A4 portrait by default and landscape on every nth page", () => {
    const plain = text(makePdf(3))
    expect((plain.match(/\/MediaBox \[0 0 595 842\]/g) ?? []).length).toBe(3)
    expect(plain).not.toContain("842 595")

    const mixed = text(makePdf(6, { landscapeEvery: 3 }))
    const boxes = [...mixed.matchAll(/\/MediaBox \[0 0 (\d+) (\d+)\]/g)].map((x) => `${x[1]}x${x[2]}`)
    expect(boxes).toEqual(["595x842", "595x842", "842x595", "595x842", "595x842", "842x595"])
  })

  it("opens in a real PDF reader (pdfjs)", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const task = pdfjs.getDocument({ data: makePdf(4, { landscapeEvery: 2 }), verbosity: 0 })
    const doc = await task.promise
    expect(doc.numPages).toBe(4)
    const p2 = await doc.getPage(2)
    const v = p2.getViewport({ scale: 1 })
    expect([v.width, v.height]).toEqual([842, 595])
    const p1 = await doc.getPage(1)
    const t = await p1.getTextContent()
    expect(t.items.map((i) => ("str" in i ? i.str : "")).join(" ")).toContain("Page 1")
    await task.destroy()
  })
})
