/**
 * The only module allowed to call `fetch` (docs/design.md §13.2; egress.test.ts enforces it).
 * Two destinations exist: our own origin for static assets (kb.json, service worker) and the
 * opt-in Ask tier 3 endpoints. Every personal-data egress must go through `sendContext`, which
 * requires an explicit per-request confirmation token from the UI.
 */

export interface AskTarget {
  kind: 'helper' | 'anthropic'
  byokKey?: string
  model?: string
}

export interface ConfirmedSend {
  /** Set by the confirmation dialog; a programmatic caller cannot forge the user's click. */
  confirmedAt: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

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
  if (target.kind === 'helper') {
    const res = await fetch('/api/v1/ask', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(target.byokKey ? { 'X-Hearth-Byok': target.byokKey } : {}),
      },
      body: JSON.stringify({ context: contextPack, question, model: target.model }),
    })
    if (!res.ok) throw new Error(`helper returned ${res.status}`)
    return (await res.json()) as { answer: string; model: string }
  }
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
