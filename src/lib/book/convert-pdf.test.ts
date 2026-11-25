import { describe, expect, it, vi } from "vitest"
import {
  PdfError,
  convertPdf,
  planScales,
  type ConvertDeps,
  type PageSource,
  type PdfSource,
  type Surface,
} from "./convert-pdf"
import { BOOK_MAX_PAGES } from "./limits"

type Size = [number, number]

function setup(sizes: Size[], over: Partial<{ type: string; failOnPage: number }> = {}) {
  const surfaces: { width: number; height: number; released: boolean; page: number | null }[] = []
  const pagesCleaned: number[] = []
  let destroyed = 0
  const live = () => surfaces.filter((s) => !s.released).length
  let maxLive = 0

  const source: PdfSource = {
    numPages: sizes.length,
    async page(n): Promise<PageSource> {
      const [width, height] = sizes[n - 1]
      return {
        width,
        height,
        async draw(surface, scale) {
          if (over.failOnPage === n) throw new Error("render exploded")
          const s = surface as Surface & { rec: (typeof surfaces)[number] }
          s.rec.page = n
          expect(s.width).toBe(Math.round(width * scale))
        },
        cleanup() {
          pagesCleaned.push(n)
        },
      }
    },
    async destroy() {
      destroyed++
    },
  }
  const deps: ConvertDeps = {
    async loadPdf() {
      return source
    },
    createSurface(width, height) {
      const rec = { width, height, released: false, page: null as number | null }
      surfaces.push(rec)
      maxLive = Math.max(maxLive, live())
      const surface = {
        width,
        height,
        rec,
        async encode(type: string, quality: number) {
          expect(type).toBe("image/webp")
          expect(quality).toBe(0.82)
          return new Blob([`p${rec.page}-${width}x${height}`], { type: over.type ?? "image/webp" })
        },
        release() {
          rec.released = true
        },
      }
      return surface
    },
  }
  return { deps, surfaces, pagesCleaned, destroyed: () => destroyed, maxLive: () => maxLive }
}

const file = () => new File([new Uint8Array([1, 2, 3])], "book.pdf", { type: "application/pdf" })

async function collect(gen: AsyncGenerator<unknown>) {
  const out = []
  for await (const p of gen) out.push(p)
  return out as Awaited<ReturnType<typeof convertPdf> extends AsyncGenerator<infer T> ? T : never>[]
}

describe("planScales", () => {
  it("makes the long edge about 1600 px and the thumbnail 160 px wide", () => {
    const portrait = planScales(595, 842)
    expect(portrait.image).toMatchObject({ width: 1131, height: 1600 })
    expect(portrait.thumb.width).toBe(160)
    expect(portrait.thumb.height).toBe(Math.round(842 * (160 / 595)))
  })

  it("handles landscape from the page's own size", () => {
    const l = planScales(842, 595)
    expect(l.image).toMatchObject({ width: 1600, height: 1131 })
    expect(l.thumb).toMatchObject({ width: 160, height: 113 })
  })

  it("never returns a zero-sized image", () => {
    const tiny = planScales(1, 5000)
    expect(tiny.image.width).toBeGreaterThanOrEqual(1)
    expect(tiny.thumb.height).toBeGreaterThanOrEqual(1)
  })
})

describe("convertPdf", () => {
  it("yields pages in order, numbered from 1, with sizes from each page", async () => {
    const t = setup([[595, 842], [842, 595], [595, 842]])
    const pages = await collect(convertPdf(file(), {}, t.deps))
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3])
    expect([pages[0].width, pages[0].height]).toEqual([1131, 1600])
    expect([pages[1].width, pages[1].height]).toEqual([1600, 1131])
    expect(await pages[1].image.text()).toBe("p2-1600x1131")
    expect(await pages[1].thumb.text()).toBe("p2-160x113")
    expect(pages[0].image.type).toBe("image/webp")
  })

  it("reports progress from 0 to total", async () => {
    const t = setup([[595, 842], [595, 842]])
    const onProgress = vi.fn()
    await collect(convertPdf(file(), { onProgress }, t.deps))
    expect(onProgress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it("holds one page at a time and releases canvases and page objects", async () => {
    const t = setup(Array.from({ length: 5 }, () => [595, 842] as Size))
    await collect(convertPdf(file(), {}, t.deps))
    expect(t.surfaces).toHaveLength(10)
    expect(t.surfaces.every((s) => s.released)).toBe(true)
    expect(t.maxLive()).toBe(1)
    expect(t.pagesCleaned).toEqual([1, 2, 3, 4, 5])
    expect(t.destroyed()).toBe(1)
  })

  it("stops between pages when aborted and still cleans up", async () => {
    const t = setup([[595, 842], [595, 842], [595, 842]])
    const ctrl = new AbortController()
    const gen = convertPdf(file(), { signal: ctrl.signal }, t.deps)
    const first = await gen.next()
    expect(first.done).toBe(false)
    ctrl.abort()
    await expect(gen.next()).rejects.toMatchObject({ name: "AbortError" })
    expect(t.pagesCleaned).toEqual([1])
    expect(t.destroyed()).toBe(1)
  })

  it("destroys the document when the caller stops early", async () => {
    const t = setup([[595, 842], [595, 842]])
    const gen = convertPdf(file(), {}, t.deps)
    await gen.next()
    await gen.return()
    expect(t.destroyed()).toBe(1)
    expect(t.surfaces.every((s) => s.released)).toBe(true)
  })

  it("rejects an already aborted signal before reading anything", async () => {
    const t = setup([[595, 842]])
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(collect(convertPdf(file(), { signal: ctrl.signal }, t.deps))).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(t.surfaces).toHaveLength(0)
  })

  it("maps a password-protected PDF to code password", async () => {
    const deps: ConvertDeps = {
      loadPdf: async () => {
        throw Object.assign(new Error("No password given"), { name: "PasswordException" })
      },
      createSurface: () => {
        throw new Error("unused")
      },
    }
    const err = await collect(convertPdf(file(), {}, deps)).catch((e) => e)
    expect(err).toBeInstanceOf(PdfError)
    expect(err.code).toBe("password")
    expect(err.message).toMatch(/password/i)
  })

  it.each(["InvalidPDFException", "FormatError", "MissingPDFException", "Whatever"])(
    "maps a %s to code corrupt",
    async (name) => {
      const deps: ConvertDeps = {
        loadPdf: async () => {
          throw Object.assign(new Error("bad"), { name })
        },
        createSurface: () => {
          throw new Error("unused")
        },
      }
      const err = await collect(convertPdf(file(), {}, deps)).catch((e) => e)
      expect(err).toBeInstanceOf(PdfError)
      expect(err.code).toBe("corrupt")
    },
  )

  it("maps a PDF with no pages to code empty", async () => {
    const t = setup([])
    const err = await collect(convertPdf(file(), {}, t.deps)).catch((e) => e)
    expect(err).toMatchObject({ name: "PdfError", code: "empty" })
    expect(t.destroyed()).toBe(1)
  })

  it("rejects more than BOOK_MAX_PAGES before rendering anything", async () => {
    const t = setup(Array.from({ length: BOOK_MAX_PAGES + 1 }, () => [595, 842] as Size))
    const err = await collect(convertPdf(file(), {}, t.deps)).catch((e) => e)
    expect(err).toMatchObject({ name: "PdfError", code: "too_many_pages" })
    expect(err.message).toContain(String(BOOK_MAX_PAGES))
    expect(t.surfaces).toHaveLength(0)
    expect(t.destroyed()).toBe(1)
  })

  it("accepts exactly BOOK_MAX_PAGES", async () => {
    const t = setup(Array.from({ length: BOOK_MAX_PAGES }, () => [100, 100] as Size))
    const gen = convertPdf(file(), {}, t.deps)
    const first = await gen.next()
    expect(first.done).toBe(false)
    await gen.return()
  })

  it("maps a render failure part-way to code corrupt and cleans up", async () => {
    const t = setup([[595, 842], [595, 842]], { failOnPage: 2 })
    const gen = convertPdf(file(), {}, t.deps)
    await gen.next()
    const err = await gen.next().catch((e) => e)
    expect(err).toMatchObject({ name: "PdfError", code: "corrupt" })
    expect(t.surfaces.every((s) => s.released)).toBe(true)
    expect(t.destroyed()).toBe(1)
  })

  it("refuses a browser that cannot make WebP", async () => {
    const t = setup([[595, 842]], { type: "image/png" })
    const err = await collect(convertPdf(file(), {}, t.deps)).catch((e) => e)
    expect(err).toBeInstanceOf(PdfError)
    expect(err.code).toBe("webp_unsupported")
    expect(err.message).toBe(
      "This browser cannot create WebP images. Use a current Chrome, Edge, Firefox or Safari.",
    )
    expect(t.surfaces.every((s) => s.released)).toBe(true)
    expect(t.destroyed()).toBe(1)
  })

  it("treats a null blob as webp_unsupported", async () => {
    const t = setup([[595, 842]])
    const orig = t.deps.createSurface
    t.deps.createSurface = (w, h) => ({ ...orig(w, h), encode: async () => null })
    const err = await collect(convertPdf(file(), {}, t.deps)).catch((e) => e)
    expect(err.code).toBe("webp_unsupported")
  })
})
