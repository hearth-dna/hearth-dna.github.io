/**
 * The only module allowed to call `fetch` (docs/design.md §13.2; egress.test.ts enforces it).
 * Two destinations exist: our own origin for static assets (kb.json, service worker) and the
 * provider the user brings a key for. There is no server of ours in between (ADR 0007). Every
 * personal-data egress to a model must go through `sendContext`, which requires an explicit
 * per-request confirmation token from the UI.
 */

export interface AskTarget {
  byokKey: string
  model?: string
}

export interface ConfirmedSend {
  /** Set by the confirmation dialog; a programmatic caller cannot forge the user's click. */
  confirmedAt: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

/**
 * A provider answered with an error, or could not be reached (`status` 0). `detail` is the
 * provider's own message when it sent one. `retryable` is the transient kind: overloaded,
 * rate-limited, a gateway hiccup or a dropped connection.
 */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly detail = '',
  ) {
    super(status ? `provider returned ${status}${detail ? `: ${detail}` : ''}` : 'provider unreachable')
    this.name = 'ProviderError'
  }
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

/** How long to wait before each retry of a transient failure; two retries, then give up. */
export const RETRY_DELAYS_MS = [1500, 4000]

/**
 * One POST to a provider, retried after a transient failure. `onRetry` tells the UI a retry is
 * coming (attempt 2, 3…). Any other error is thrown at once: a bad key or a rejected file will
 * not get better by asking again.
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  o: { delays?: number[]; onRetry?: (attempt: number, e: ProviderError) => void } = {},
): Promise<unknown> {
  const delays = o.delays ?? RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    let error: ProviderError
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
      if (res.ok) return await res.json()
      error = new ProviderError(res.status, await providerMessage(res))
    } catch (e) {
      if (e instanceof ProviderError) throw e
      error = new ProviderError(0, e instanceof Error ? e.message : String(e))
    }
    if (!error.retryable || attempt >= delays.length) throw error
    o.onRetry?.(attempt + 2, error)
    await new Promise((r) => setTimeout(r, delays[attempt]))
  }
}

/** The human part of a provider's error body (Gemini and Anthropic both nest it in `error`). */
async function providerMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return (body.error?.message ?? '').slice(0, 300)
  } catch {
    return ''
  }
}
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash'

export interface DocumentPart {
  mime: string
  /** base64 without the data: prefix */
  data: string
}

/**
 * Sends the pages of one medical document straight to Gemini with the user's own key and returns
 * the model's JSON text. Browser → provider directly; nothing of ours sits in between.
 */
export async function readDocumentWithGemini(
  target: { byokKey: string; model?: string },
  parts: DocumentPart[],
  prompt: string,
  responseSchema: object,
  confirmed: ConfirmedSend,
  retry: { delays?: number[]; onRetry?: (attempt: number, e: ProviderError) => void } = {},
): Promise<{ text: string; model: string }> {
  if (!confirmed?.confirmedAt) throw new Error('refusing to send without an explicit confirmation')
  if (!target.byokKey) throw new Error('an API key is required for a direct provider call')
  const model = target.model || GEMINI_DEFAULT_MODEL
  const body = (await postJson(
    `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': target.byokKey },
    {
      contents: [
        {
          role: 'user',
          parts: [
            ...parts.map((p) => ({ inlineData: { mimeType: p.mime, data: p.data } })),
            { text: prompt },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema },
    },
    retry,
  )) as {
    modelVersion?: string
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text) throw new ProviderError(200, 'no text in the answer')
  return { text, model: body.modelVersion ?? model }
}

export async function fetchOwnAsset(path: string): Promise<Response> {
  if (!path.startsWith('/')) throw new Error('own-origin assets only')
  return fetch(path)
}

export async function sendContext(
  target: AskTarget,
  contextPack: string,
  question: string,
  confirmed: ConfirmedSend,
): Promise<{ answer: string; model: string }> {
  if (!confirmed?.confirmedAt) throw new Error('refusing to send without an explicit confirmation')
  if (!target.byokKey) throw new Error('an API key is required for a direct provider call')
  const body = (await postJson(
    ANTHROPIC_URL,
    {
      'x-api-key': target.byokKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    {
      model: target.model ?? 'claude-sonnet-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: `${contextPack}\n\n## Question\n${question}` }],
    },
  )) as { model: string; content: { type: string; text: string }[] }
  return {
    answer: body.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join(''),
    model: body.model,
  }
}
