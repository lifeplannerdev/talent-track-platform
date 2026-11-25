import { describe, expect, it } from "vitest"
import { BOOK_MAX_PAGES, BOOK_MAX_PDF_BYTES, checkPdfFile } from "./limits"

const MB = 1024 * 1024

describe("book limits", () => {
  it("uses the agreed caps", () => {
    expect(BOOK_MAX_PDF_BYTES).toBe(50 * MB)
    expect(BOOK_MAX_PAGES).toBe(400)
  })

  it("accepts a normal PDF, also at exactly 50 MiB", () => {
    expect(checkPdfFile({ name: "Book.pdf", size: 2.5 * MB, type: "application/pdf" })).toBeNull()
    expect(checkPdfFile({ name: "Book.PDF", size: 50 * MB, type: "" })).toBeNull()
    expect(checkPdfFile({ name: "book.pdf", size: 1000 })).toBeNull()
  })

  it("rejects 50 MiB plus one byte", () => {
    const message = checkPdfFile({ name: "book.pdf", size: 50 * MB + 1, type: "application/pdf" })
    expect(message).toMatch(/50 MB/)
  })

  it("rejects files that are not PDFs", () => {
    expect(checkPdfFile({ name: "book.docx", size: 1000, type: "application/msword" })).toMatch(/PDF/)
    expect(checkPdfFile({ name: "book", size: 1000 })).toMatch(/PDF/)
    expect(checkPdfFile({ name: "book.pdf", size: 1000, type: "image/png" })).toMatch(/PDF/)
  })

  it("rejects empty files", () => {
    expect(checkPdfFile({ name: "book.pdf", size: 0, type: "application/pdf" })).toMatch(/empty/i)
  })
})
