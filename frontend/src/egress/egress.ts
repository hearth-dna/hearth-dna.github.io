/**
 * The only module allowed to call `fetch` (docs/design.md §13.2; egress.test.ts enforces it).
 * Two destinations exist: our own origin for static assets (kb.json, service worker) and the
 * provider the user brings a key for. There is no server of ours in between (ADR 0007). Every
 * personal-data egress must go through `sendContext`, which requires an explicit per-request
 * confirmation token from the UI.
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
): Promise<{ text: string; model: string }> {
  if (!confirmed?.confirmedAt) throw new Error('refusing to send without an explicit confirmation')
  if (!target.byokKey) throw new Error('an API key is required for a direct provider call')
  const model = target.model || GEMINI_DEFAULT_MODEL
  const res = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': target.byokKey },
    body: JSON.stringify({
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
    }),
  })
  if (!res.ok) throw new Error(`provider returned ${res.status}`)
  const body = (await res.json()) as {
    modelVersion?: string
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text) throw new Error('provider returned no text')
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
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': target.byokKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: target.model ?? 'claude-sonnet-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: `${contextPack}\n\n## Question\n${question}` }],
    }),
  })
  if (!res.ok) throw new Error(`provider returned ${res.status}`)
  const body = (await res.json()) as { model: string; content: { type: string; text: string }[] }
  return {
    answer: body.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join(''),
    model: body.model,
  }
}
