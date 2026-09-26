/**
 * The text layer of a PDF, as lines a lab report parser can read, or null for a scan (no text
 * layer) and in the portable archive (which leaves pdf.js out; its PDFs go to the model reader).
 * pdf.js and its worker load on demand from this origin; the file never leaves the device.
 */

export interface TextItem {
  str: string
  /** pdf.js text-space transform: [a, b, c, d, x, y]. */
  transform: number[]
  width: number
}

/**
 * Items → lines: same baseline (within half a glyph) is one line, left to right; a horizontal gap
 * wider than about two spaces becomes a tab so columns stay columns for the parser.
 */
export function linesFromItems(items: TextItem[]): string[] {
  const rows: { y: number; items: TextItem[] }[] = []
  for (const it of items) {
    if (!it.str.trim()) continue
    const y = it.transform[5]
    const size = Math.abs(it.transform[3]) || 10
    const row = rows.find((r) => Math.abs(r.y - y) < size / 2)
    if (row) row.items.push(it)
    else rows.push({ y, items: [it] })
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const sorted = r.items.sort((a, b) => a.transform[4] - b.transform[4])
      let line = ''
      let end = Number.NEGATIVE_INFINITY
      for (const it of sorted) {
        const x = it.transform[4]
        const size = Math.abs(it.transform[3]) || 10
        if (line) line += x - end > size ? '\t' : x - end > size / 8 ? ' ' : ''
        line += it.str
        end = x + it.width
      }
      return line.trim()
    })
}

/** Below this many characters per page the PDF is a scan with, at most, a stray text stamp. */
const MIN_CHARS_PER_PAGE = 40

export async function pdfText(bytes: Uint8Array): Promise<string | null> {
  if (__HEARTH_ARCHIVE__) return null
  // The legacy build: the modern one calls Map.prototype.getOrInsertComputed, Promise.withResolvers
  // and Math.sumPrecise unpolyfilled, which the phone apps' engines (Android WebView 108+, iOS 17
  // WebKit) and current Safari lack. The legacy build carries the polyfills.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  ).default
  // A copy: pdf.js transfers the buffer to its worker, and the caller may still need the bytes.
  // No font or character-map URLs are given, so the worker has nothing to fetch.
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useWorkerFetch: false })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent()
      pages.push(linesFromItems(content.items.filter((i) => 'str' in i) as TextItem[]).join('\n'))
    }
    const text = pages.join('\n')
    return text.replace(/\s/g, '').length >= MIN_CHARS_PER_PAGE * doc.numPages ? text : null
  } finally {
    await task.destroy()
  }
}
