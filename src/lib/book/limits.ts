// Upload caps for a curriculum book (pure: safe for client and server code).
// The page cap matches the check in migration 0028; the byte cap is the local Storage limit.

export const BOOK_MAX_PDF_BYTES = 50 * 1024 * 1024
export const BOOK_MAX_PAGES = 400

export function checkPdfFile(file: { size: number; type?: string; name: string }): string | null {
  const isPdfName = file.name.toLowerCase().endsWith(".pdf")
  const typeOk = !file.type || file.type === "application/pdf"
  if (!isPdfName || !typeOk) return "Choose a PDF file."
  if (file.size === 0) return "This file is empty. Choose a PDF file with pages in it."
  if (file.size > BOOK_MAX_PDF_BYTES) {
    return "This PDF is larger than 50 MB. Reduce its size and try again."
  }
  return null
}
