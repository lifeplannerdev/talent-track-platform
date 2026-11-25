// Builds a small valid multi-page PDF in code (no dependency), for tests and e2e.
// Deterministic: the same arguments give the same bytes. Every page shows "Page N"
// and a coloured rectangle so rendered pages can be told apart.

export type MakePdfOptions = { landscapeEvery?: number }

const PORTRAIT: [number, number] = [595, 842]
const LANDSCAPE: [number, number] = [842, 595]

export function makePdf(pages: number, opts: MakePdfOptions = {}): Uint8Array {
  if (!Number.isInteger(pages) || pages < 1) throw new Error("pages must be a whole number of at least 1")
  const every = opts.landscapeEvery
  if (every !== undefined && (!Number.isInteger(every) || every < 1)) {
    throw new Error("landscapeEvery must be a whole number of at least 1")
  }

  // Object numbers: 1 catalog, 2 pages, 3 font, then (page, content) pairs from 4.
  const objects: string[] = []
  const pageObj = (n: number) => 4 + (n - 1) * 2
  const kids = Array.from({ length: pages }, (_, i) => `${pageObj(i + 1)} 0 R`).join(" ")
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

  for (let n = 1; n <= pages; n++) {
    const landscape = every !== undefined && n % every === 0
    const [w, h] = landscape ? LANDSCAPE : PORTRAIT
    const r = ((n * 53) % 100) / 100
    const g = ((n * 97 + 30) % 100) / 100
    const b = ((n * 29 + 60) % 100) / 100
    const stream = [
      `${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg`,
      `40 40 ${w - 80} ${Math.round(h / 3)} re f`,
      "0 g",
      "BT",
      "/F1 48 Tf",
      `60 ${h - 120} Td`,
      `(Page ${n}) Tj`,
      "ET",
    ].join("\n")
    objects[pageObj(n)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj(n) + 1} 0 R >>`
    objects[pageObj(n) + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  }

  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefAt = out.length
  out += `xref\n0 ${objects.length}\n`
  out += "0000000000 65535 f \n"
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

  // Pure ASCII, so one byte per character and offsets above are byte offsets.
  return Uint8Array.from(out, (c) => c.charCodeAt(0))
}
