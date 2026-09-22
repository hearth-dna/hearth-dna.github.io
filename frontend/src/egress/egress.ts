/**
 * The only module allowed to call `fetch` (docs/design.md §13.2; egress.test.ts enforces it).
 * Three destinations exist: our own origin for static assets (kb.json, service worker), the
 * provider the user brings a key for, and the cloud drive the user signs in to for backups
 * (ADR 0009). There is no server of ours in between (ADR 0007). Every personal-data egress to a
 * model must go through `sendContext`, which requires an explicit per-request confirmation token
 * from the UI; a cloud backup goes through `cloudRequest`, which reaches the provider's API hosts
 * and nothing else.
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

// ---- cloud backups (ADR 0009) ----------------------------------------------------------------

export type CloudProvider = 'google' | 'dropbox'

/** The only hosts a cloud backup may reach, per provider. Kept in step with the CSP. */
const CLOUD_HOSTS: Record<CloudProvider, string[]> = {
  google: ['www.googleapis.com'],
  dropbox: ['api.dropboxapi.com', 'content.dropboxapi.com'],
}

export interface CloudRequest {
  provider: CloudProvider
  /** A short-lived access token from the native shell; never a refresh token. */
  token: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  url: string
  headers?: Record<string, string>
  /** Metadata (names, folder ids) as a string, or file content: a snapshot or a document. */
  body?: string | Uint8Array
}

/**
 * One call to the user's own cloud drive, and only to that provider's API hosts. What goes there is
 * a backup, encrypted when the user set a passphrase: the same choice, and the same warning, as a
 * folder the user picks (ADR 0009).
 */
export async function cloudRequest(req: CloudRequest): Promise<Response> {
  const url = new URL(req.url)
  if (url.protocol !== 'https:' || !CLOUD_HOSTS[req.provider]?.includes(url.host))
    throw new Error(`refusing to contact ${url.host} for a ${req.provider} backup`)
  if (!req.token) throw new Error('not signed in')
  return fetch(url, {
    method: req.method,
    headers: { ...req.headers, authorization: `Bearer ${req.token}` },
    body: req.body as BodyInit | undefined,
  })
}
