/**
 * The phones' side of the backup location (docs/decisions/0008-cloud-backups-on-the-phones.md).
 *
 * A WebView has no directory picker, so the Android and iOS shells lend theirs: the system document
 * picker, which lists iCloud Drive, Google Drive, Dropbox, OneDrive and local storage alike, and a
 * handful of file calls on whatever the user picked. The provider's own app moves the bytes; this
 * is file I/O on the device, not a network path, and `egress.ts` is untouched.
 *
 * One message channel, request/response by id:
 *   Android — `HearthFiles`, a `WebViewCompat.addWebMessageListener` object that only the app's own
 *             origin is given; replies arrive on its `onmessage` as `{ id, ok, value | error }`.
 *   iOS     — `webkit.messageHandlers.hearthFiles`, a `WKScriptMessageHandlerWithReply` whose
 *             `postMessage` already returns a promise of the value.
 *
 * Bytes cross in base64 chunks, never a whole file at once: a family snapshot is tens of megabytes,
 * and one string that size is an out-of-memory error on a mid-range phone.
 */

import type { CloudProvider } from '../egress/egress'

interface AndroidChannel {
  postMessage(message: string): void
  onmessage: ((event: MessageEvent<string>) => void) | null
}
interface IosChannel {
  postMessage(message: unknown): Promise<unknown>
}
declare global {
  interface Window {
    HearthFiles?: AndroidChannel
    webkit?: { messageHandlers?: { hearthFiles?: IosChannel } }
  }
}

/** Kept in step with the shells' own chunk size (Files.kt, NativeFiles.swift). */
const CHUNK_BYTES = 1 << 20

/**
 * What the user can choose. The first three open the system picker (a folder where the provider
 * offers one, else one file); `icloud` is Hearth's own folder in iCloud Drive, with no picker; the
 * other two sign in to a cloud drive (ADR 0009).
 */
export type PickMode = 'folder' | 'newFile' | 'existingFile' | 'icloud' | CloudProvider

/**
 * A location the user picked. `ref` is opaque to the page: a persisted content URI on Android, a
 * security-scoped bookmark on iOS. It is a grant, not a path, and is useless outside this app.
 */
export interface Location {
  ref: string
  name: string
  /** One file rather than a folder: it holds the snapshot and nothing else. */
  single: boolean
}

/** The ref of Hearth's own folder in iCloud Drive; the shell resolves it, no bookmark needed. */
export const ICLOUD = 'icloud'

const ios = () => (typeof window === 'undefined' ? undefined : window.webkit?.messageHandlers?.hearthFiles)
const android = () => (typeof window === 'undefined' ? undefined : window.HearthFiles)

export const available = () => Boolean(ios() ?? android())

let nextId = 0
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const apple = ios()
  if (apple) return apple.postMessage({ op, ...args }) as Promise<T>
  const channel = android()
  if (!channel) return Promise.reject(new Error('this app has no native file access'))
  channel.onmessage ??= (event) => {
    const reply = JSON.parse(event.data) as { id: number; ok: boolean; value?: unknown; error?: string }
    const w = waiting.get(reply.id)
    if (!w) return
    waiting.delete(reply.id)
    if (reply.ok) w.resolve(reply.value ?? null)
    else w.reject(new Error(reply.error ?? 'file access failed'))
  }
  const id = ++nextId
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
    channel.postMessage(JSON.stringify({ id, op, ...args }))
  })
}

// ---- base64, in slices small enough for String.fromCharCode's argument limit -----------------

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// ---- the calls --------------------------------------------------------------------------------

/** Opens the system picker; null when the user backed out. Must run from a click. */
export const pick = (mode: PickMode, suggested: string) => call<Location | null>('pick', { mode, suggested })

/**
 * Whether the grant still holds. The returned ref may differ from the one passed (iOS refreshes a
 * stale bookmark); the caller keeps the new one.
 */
export const status = (loc: Location) => call<{ granted: boolean; ref: string }>('status', { ref: loc.ref })

/**
 * What the user can choose here, best first: the cloud drives this build is set up for (the shell
 * says which), then the system picker. Android's picker lists Drive and Dropbox only for single
 * files, so a file comes before a folder there; iOS lends folders.
 */
export async function modes(): Promise<PickMode[]> {
  const clouds = await call<PickMode[]>('cloudProviders').catch(() => [] as PickMode[])
  if (ios()) return [...clouds, 'folder', 'newFile', 'existingFile']
  if (android()) return [...clouds, 'newFile', 'existingFile', 'folder']
  return []
}

/** A signed-in cloud account, as the page remembers it. `account` is what the shell keys it by. */
export interface CloudAccount {
  account: string
  /** What to show: the account's e-mail or display name. */
  label: string
}

/** Signs in on the provider's own screen. Null when the user backed out. Must run from a click. */
export const cloudSignIn = (provider: CloudProvider) =>
  call<(CloudAccount & { token: string }) | null>('cloudSignIn', { provider })

/**
 * A fresh access token without any screen, from the grant the shell keeps; null when the user has
 * to sign in again. `stale` is a token the provider just refused, so the shell does not hand the
 * same one back. The refresh token stays in the shell and never reaches the page.
 */
export const cloudToken = (provider: CloudProvider, account: string, stale: string | null) =>
  call<string | null>('cloudToken', { provider, account, stale })

/** Revokes and forgets the grant. Best effort, like `release`. */
export const cloudSignOut = (provider: CloudProvider, account: string) =>
  call<null>('cloudSignOut', { provider, account }).catch(() => null)

/**
 * The phone apps' secure storage (Android Keystore, iOS Keychain), for the backup passphrase: kept
 * across restarts, on this device only, never in the page's own storage.
 */
export const secretGet = (name: string) => call<string | null>('secretGet', { name })
export const secretSet = (name: string, value: string) => call<null>('secretSet', { name, value })
export const secretDelete = (name: string) => call<null>('secretDelete', { name })

/** Gives the grant back to the system. Best effort: the location is being forgotten anyway. */
export const release = (loc: Location) => call<null>('release', { ref: loc.ref }).catch(() => null)

/** A file inside a picked folder, or — with `name` null — the picked file itself. */
interface Target {
  ref: string
  path: string[]
  name: string | null
}

export const list = (ref: string, path: string[]) => call<string[]>('list', { ref, path })

/** True when the folder exists afterwards. */
export const mkdir = (ref: string, path: string[], name: string, create: boolean) =>
  call<boolean>('mkdir', { ref, path, name, create })

/** Deletes a file or a whole folder. False when there was nothing to delete. */
export const remove = (t: Target) => call<boolean>('remove', { ...t })

/** The file's bytes, or null when it is not there. */
export async function read(t: Target): Promise<Uint8Array | null> {
  const handle = await call<string | null>('open', { ...t })
  if (handle === null) return null
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const chunk = await call<string>('chunk', { handle })
    if (chunk === '') break
    const bytes = fromBase64(chunk)
    parts.push(bytes)
    size += bytes.length
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** The file's first `bytes` (one chunk is plenty for a header), or null when it is not there. */
export async function readHead(t: Target, bytes: number): Promise<Uint8Array | null> {
  const handle = await call<string | null>('open', { ...t })
  if (handle === null) return null
  try {
    return fromBase64(await call<string>('chunk', { handle })).subarray(0, bytes)
  } finally {
    await call('close', { handle, ok: false }).catch(() => {})
  }
}

/** Replaces the file's content, creating it when it is not there. */
export async function write(t: Target, bytes: Uint8Array): Promise<void> {
  const handle = await call<string>('create', { ...t })
  try {
    for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
      await call('append', { handle, data: toBase64(bytes.subarray(at, at + CHUNK_BYTES)) })
    }
  } catch (e) {
    await call('close', { handle, ok: false }).catch(() => {})
    throw e
  }
  await call('close', { handle, ok: true })
}
