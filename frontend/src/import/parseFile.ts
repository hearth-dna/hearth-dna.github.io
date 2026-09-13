import type { Call, Provider } from '../types'
import { detectBuild, detectProvider, isUsableCall, PARSERS } from './providers'

export interface ParseResult {
  provider: Provider
  build: string
  calls: Call[]
  skipped: number
}

/** Parses a whole raw-data text. Yields to the event loop every ~50k lines so the UI stays alive. */
export async function parseRawText(
  text: string,
  onProgress?: (done: number, total: number) => void,
  forced?: Provider,
): Promise<ParseResult> {
  const provider = forced ?? detectProvider(text)
  const build = detectBuild(text)
  const parse = PARSERS[provider]
  const calls: Call[] = []
  let skipped = 0
  let start = 0
  let n = 0
  const total = text.length
  while (start < total) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = total
    const line = text.slice(start, end).replace(/\r$/, '')
    start = end + 1
    const c = parse(line)
    if (c === null) continue
    if (isUsableCall(c)) calls.push(c)
    else skipped++
    if (++n % 50000 === 0) {
      onProgress?.(start, total)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  onProgress?.(total, total)
  return { provider, build, calls, skipped }
}
