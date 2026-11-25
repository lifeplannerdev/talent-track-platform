// Browser only: turns a PDF into one WebP page image and one thumbnail per page.
// pdfjs-dist is imported dynamically inside convertPdf, never at module top and never on the
// server, so this file is safe to import from a client component that is server-rendered.
// The PDF loading and the canvas work sit behind two small seams (ConvertDeps) so everything
// else is unit-tested with fakes; the real pdfjs path is exercised in the e2e run.

import { BOOK_MAX_PAGES } from "./limits"

export type ConvertedPage = { page: number; image: Blob; thumb: Blob; width: number; height: number }

export type PdfErrorCode = "password" | "corrupt" | "empty" | "too_many_pages" | "webp_unsupported"

const MESSAGES: Record<PdfErrorCode, string> = {
  password: "This PDF is password protected. Remove the password and try again.",
  corrupt: "This PDF could not be read. It may be damaged. Try saving it again as a PDF.",
  empty: "This PDF has no pages.",
  too_many_pages: `This PDF has more than ${BOOK_MAX_PAGES} pages. Split it into smaller books.`,
  webp_unsupported:
    "This browser cannot create WebP images. Use a current Chrome, Edge or Firefox on a computer to upload books.",
}

export class PdfError extends Error {
  readonly code: PdfErrorCode
  constructor(code: PdfErrorCode) {
    super(MESSAGES[code])
    this.name = "PdfError"
    this.code = code
  }
}

export const IMAGE_LONG_EDGE = 1600
export const THUMB_WIDTH = 160
export const WEBP_QUALITY = 0.82

type Plan = { width: number; height: number; scale: number }

/** Pixel sizes and pdf.js scales for the page image and the thumbnail, from the page's own size. */
export function planScales(pageWidth: number, pageHeight: number): { image: Plan; thumb: Plan } {
  const at = (scale: number): Plan => ({
    width: Math.max(1, Math.round(pageWidth * scale)),
    height: Math.max(1, Math.round(pageHeight * scale)),
    scale,
  })
  return {
    image: at(IMAGE_LONG_EDGE / Math.max(pageWidth, pageHeight)),
    thumb: at(THUMB_WIDTH / pageWidth),
  }
}

// Seams ---------------------------------------------------------------------------------

export interface Surface {
  readonly width: number
  readonly height: number
  /** Paint another surface onto this one, scaled to fill it (used for the thumbnail). */
  drawFrom(source: Surface): void
  /** Encode what was drawn; null when the browser cannot produce the type. */
  encode(type: string, quality: number): Promise<Blob | null>
  /** Free the pixel memory now. */
  release(): void
}

export interface PageSource {
  /** Size in PDF points, rotation applied. */
  readonly width: number
  readonly height: number
  draw(surface: Surface, scale: number): Promise<void>
  cleanup(): void
}

export interface PdfSource {
  readonly numPages: number
  page(n: number): Promise<PageSource>
  destroy(): Promise<void>
}

export interface ConvertDeps {
  loadPdf(data: Uint8Array): Promise<PdfSource>
  createSurface(width: number, height: number): Surface
}

// Real implementations ------------------------------------------------------------------

// The pdf.js render target is a DOM canvas (pdf.js 6 renders into a canvas element), so this
// path is browser main thread only. There is deliberately no OffscreenCanvas path.
type DomSurface = Surface & { canvas: HTMLCanvasElement }

function createDomSurface(width: number, height: number): DomSurface {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new PdfError("corrupt")
  // Pages are transparent by default; WebP keeps alpha, so paint the paper first.
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)
  return {
    canvas,
    width,
    height,
    drawFrom(source) {
      const from = (source as DomSurface).canvas
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(from, 0, 0, width, height)
    },
    encode(type, quality) {
      return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
    },
    release() {
      // Setting the size to 0 frees the backing bitmap right away (Safari keeps it otherwise).
      canvas.width = 0
      canvas.height = 0
    },
  }
}

async function loadWithPdfjs(data: Uint8Array): Promise<PdfSource> {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString()
  const task = pdfjs.getDocument({ data })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    await task.destroy().catch(() => {})
    throw e
  }
  return {
    numPages: doc.numPages,
    async page(n) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      return {
        width: base.width,
        height: base.height,
        async draw(surface, scale) {
          const viewport = page.getViewport({ scale })
          const { canvas } = surface as DomSurface
          await page.render({ canvas, viewport }).promise
        },
        cleanup() {
          page.cleanup()
        },
      }
    },
    async destroy() {
      // pdf.js 6: the loading task owns the worker and the document.
      await task.destroy()
    },
  }
}

const defaultDeps: ConvertDeps = { loadPdf: loadWithPdfjs, createSurface: createDomSurface }

// Conversion ----------------------------------------------------------------------------

function abortError() {
  return new DOMException("The conversion was cancelled.", "AbortError")
}

function toPdfError(e: unknown): unknown {
  if (e instanceof PdfError) return e
  if (e instanceof DOMException && e.name === "AbortError") return e
  const name = typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : ""
  return new PdfError(name === "PasswordException" ? "password" : "corrupt")
}

async function encodeWebp(surface: Surface): Promise<Blob> {
  const blob = await surface.encode("image/webp", WEBP_QUALITY)
  if (!blob || blob.type !== "image/webp") throw new PdfError("webp_unsupported")
  return blob
}

/** Renders the page once at image size, then scales that canvas down for the thumbnail. */
async function renderPage(page: PageSource, plans: ReturnType<typeof planScales>, deps: ConvertDeps) {
  const surface = deps.createSurface(plans.image.width, plans.image.height)
  try {
    await page.draw(surface, plans.image.scale)
    const image = await encodeWebp(surface)
    const small = deps.createSurface(plans.thumb.width, plans.thumb.height)
    try {
      small.drawFrom(surface)
      return { image, thumb: await encodeWebp(small) }
    } finally {
      small.release()
    }
  } finally {
    surface.release()
  }
}

/**
 * Yields one converted page at a time, in order, so the caller can upload while converting.
 * Throws PdfError (password, corrupt, empty, too_many_pages, webp_unsupported) or an AbortError.
 */
export async function* convertPdf(
  file: File,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
  deps: ConvertDeps = defaultDeps,
): AsyncGenerator<ConvertedPage, void, void> {
  const { onProgress, signal } = opts
  if (signal?.aborted) throw abortError()

  let source: PdfSource | undefined
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    source = await deps.loadPdf(data)
    const total = source.numPages
    if (total < 1) throw new PdfError("empty")
    if (total > BOOK_MAX_PAGES) throw new PdfError("too_many_pages")

    onProgress?.(0, total)
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) throw abortError()
      const page = await source.page(n)
      let converted: ConvertedPage
      try {
        const plan = planScales(page.width, page.height)
        const { image, thumb } = await renderPage(page, plan, deps)
        converted = { page: n, image, thumb, width: plan.image.width, height: plan.image.height }
      } finally {
        page.cleanup()
      }
      onProgress?.(n, total)
      yield converted
    }
  } catch (e) {
    throw toPdfError(e)
  } finally {
    await source?.destroy().catch(() => {})
  }
}
