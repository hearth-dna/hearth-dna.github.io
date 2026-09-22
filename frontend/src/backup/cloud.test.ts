import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveAccount, driveFolders, dropbox, googleDrive, SignInNeeded, type TokenSource } from './cloud'
import { writeSnapshot } from './folder'

/**
 * In-memory stand-ins for the two REST APIs, just the calls cloud.ts makes, so the request shapes,
 * the folder bookkeeping and the token retry are exercised without an account.
 */

const sealed = (text: string) => new TextEncoder().encode(`HRTH2${text}`)
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const bodyBytes = async (init?: RequestInit) =>
  typeof init?.body === 'string' ? new TextEncoder().encode(init.body) : (init?.body as Uint8Array)

/** Answers with 401 until the token is `good`, so the first call of a test exercises the refresh. */
function tokens(): { source: TokenSource; asked: boolean[] } {
  const asked: boolean[] = []
  let current = 'stale'
  return {
    asked,
    source: async (fresh) => {
      asked.push(fresh)
      if (fresh) current = 'good'
      return current
    },
  }
}
const authorised = (init?: RequestInit) =>
  (init?.headers as Record<string, string>)?.authorization === 'Bearer good'

function fakeDrive() {
  interface F {
    id: string
    name: string
    parent: string
    folder: boolean
    trashed: boolean
    data?: Uint8Array
  }
  const files = new Map<string, F>()
  const uploads = new Map<string, { id?: string; name?: string; parent?: string }>()
  let n = 0
  const fetch = async (input: URL | string, init?: RequestInit) => {
    if (!authorised(init)) return json({ error: 'expired' }, 401)
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname
    if (path === '/drive/v3/about') return json({ user: { emailAddress: 'someone@hearth.example' } })
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const parent = /^'(.*)' in parents/.exec(q)?.[1]
      const contains = /name contains '(.*?)'/.exec(q)?.[1]
      const exact = /name = '(.*?)'/.exec(q)?.[1]
      const onlyFolders = q.includes('mimeType')
      const list = [...files.values()].filter(
        (f) =>
          !f.trashed &&
          (!onlyFolders || f.folder) &&
          (parent === undefined || f.parent === parent) &&
          (contains === undefined || f.name.includes(contains)) &&
          (exact === undefined || f.name === exact),
      )
      return json({
        files: list.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.folder ? 'application/vnd.google-apps.folder' : 'application/octet-stream',
          parents: [f.parent],
        })),
      })
    }
    const meta = /^\/drive\/v3\/files\/(\w+)$/.exec(path)
    if (meta && method === 'GET' && !url.searchParams.has('alt')) {
      if (meta[1] === 'root') return json({ id: 'root', name: 'My Drive' })
      const f = files.get(meta[1])
      return f ? json({ id: f.id, name: f.name, parents: [f.parent] }) : json({}, 404)
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(init?.body))
      const id = `f${++n}`
      files.set(id, { id, name: meta.name, parent: meta.parents[0], folder: true, trashed: false })
      return json({ id })
    }
    const upload = /^\/upload\/drive\/v3\/files(?:\/(\w+))?$/.exec(path)
    if (upload && url.searchParams.get('uploadType') === 'resumable') {
      const key = `u${++n}`
      const meta = JSON.parse(String(init?.body))
      uploads.set(key, { id: upload[1], name: meta.name, parent: meta.parents?.[0] })
      return new Response(null, {
        headers: { location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${key}` },
      })
    }
    if (method === 'PUT' && url.searchParams.has('upload_id')) {
      const u = uploads.get(url.searchParams.get('upload_id') ?? '')
      if (!u) return json({}, 404)
      const data = await bodyBytes(init)
      if (u.id) files.set(u.id, { ...(files.get(u.id) as F), data })
      else {
        const id = `f${++n}`
        files.set(id, { id, name: u.name ?? '', parent: u.parent ?? '', folder: false, trashed: false, data })
      }
      return json({})
    }
    const one = /^\/drive\/v3\/files\/(\w+)$/.exec(path)
    if (one && url.searchParams.get('alt') === 'media') {
      const f = files.get(one[1])
      return f?.data ? new Response(f.data as BodyInit) : json({}, 404)
    }
    if (one && method === 'PATCH') {
      const f = files.get(one[1])
      if (f) f.trashed = JSON.parse(String(init?.body)).trashed
      return json({})
    }
    return json({ error: `unexpected ${method} ${path}` }, 400)
  }
  return { files, fetch }
}

function fakeDropbox() {
  const files = new Map<string, Uint8Array>()
  const folders = new Set<string>([''])
  const fetch = async (input: URL | string, init?: RequestInit) => {
    if (!authorised(init)) return json({ error: 'expired' }, 401)
    const url = new URL(String(input))
    const headers = init?.headers as Record<string, string>
    const arg = headers['dropbox-api-arg']
      ? JSON.parse(headers['dropbox-api-arg'])
      : JSON.parse(String(init?.body))
    const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
    switch (url.pathname) {
      case '/2/files/list_folder': {
        if (!folders.has(arg.path)) return json({ error: 'path/not_found' }, 409)
        const names = [...files.keys(), ...folders]
          .filter((p) => p !== '' && parentOf(p) === arg.path)
          .map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1) }))
        return json({ entries: names, cursor: 'c', has_more: false })
      }
      case '/2/files/download': {
        const f = files.get(arg.path)
        return f ? new Response(f as BodyInit) : json({ error: 'path/not_found' }, 409)
      }
      case '/2/files/upload':
        files.set(arg.path, await bodyBytes(init))
        return json({})
      case '/2/files/delete_v2':
        return files.delete(arg.path) || folders.delete(arg.path) ? json({}) : json({}, 409)
      case '/2/files/get_metadata':
        if (folders.has(arg.path)) return json({ '.tag': 'folder' })
        return files.has(arg.path) ? json({ '.tag': 'file' }) : json({}, 409)
      case '/2/files/create_folder_v2':
        folders.add(arg.path)
        return json({})
    }
    return json({ error: `unexpected ${url.pathname}` }, 400)
  }
  return { files, folders, fetch }
}

afterEach(() => vi.unstubAllGlobals())

describe('Google Drive backups', () => {
  it('makes a Hearth folder once, overwrites the snapshot in place and reads it back', async () => {
    const drive = fakeDrive()
    vi.stubGlobal('fetch', drive.fetch)
    const t = tokens()
    const dir = googleDrive(t.source, 'Google Drive (me)')
    await writeSnapshot(dir, 'hearth-backup.hearth', sealed('one'), 'https://hearth.example')
    await writeSnapshot(dir, 'hearth-backup.hearth', sealed('two'), 'https://hearth.example')
    // The expired token was refused once and replaced, not asked for on every call.
    expect(t.asked.filter(Boolean)).toHaveLength(1)
    const folders = [...drive.files.values()].filter((f) => f.folder)
    expect(folders.map((f) => [f.name, f.parent])).toEqual([['Hearth', 'root']])
    expect(text(await dir.read('hearth-backup.hearth'))).toBe('HRTH2two')
    // No .1/.2 copies: Drive keeps the earlier versions of the file itself.
    expect((await dir.names()).sort()).toEqual(['README.txt', 'hearth-backup.hearth'])
    expect(await dir.read('missing')).toBeNull()
  })

  it('keeps documents in a subfolder and moves deleted files to the bin', async () => {
    const drive = fakeDrive()
    vi.stubGlobal('fetch', drive.fetch)
    const dir = googleDrive(tokens().source, 'Google Drive (me)')
    expect(await dir.subdir('attachments')).toBeNull()
    const sub = await dir.subdir('attachments', true)
    await sub?.write('abc.att', new TextEncoder().encode('HRTH1doc'))
    expect(await sub?.names()).toEqual(['abc.att'])
    expect((await dir.subdir('attachments'))?.name).toBe('attachments')
    await dir.remove('attachments')
    expect(await dir.names()).toEqual([])
    expect([...drive.files.values()].some((f) => f.name === 'attachments' && f.trashed)).toBe(true)
  })

  it('lists and creates folders for the chooser, then backs up into the chosen one', async () => {
    const drive = fakeDrive()
    vi.stubGlobal('fetch', drive.fetch)
    const t = tokens()
    const browse = driveFolders(t.source)
    const family = await browse.create('root', 'Family')
    const backups = await browse.create(family.id, 'Backups')
    drive.files.set('loose', {
      id: 'loose',
      name: 'notes.txt',
      parent: 'root',
      folder: false,
      trashed: false,
    })
    expect((await browse.list('root')).map((f) => f.name)).toEqual(['Family'])
    expect(await browse.list(family.id)).toEqual([backups])

    const dir = googleDrive(t.source, 'Google Drive › My Drive › Family › Backups', backups.id)
    await writeSnapshot(dir, 'hearth-backup.hearth', sealed('one'), 'https://hearth.example')
    const snapshot = [...drive.files.values()].find((f) => f.name === 'hearth-backup.hearth')
    expect(snapshot?.parent).toBe(backups.id)
    // No default Hearth folder when one was chosen.
    expect([...drive.files.values()].some((f) => f.name === 'Hearth')).toBe(false)
  })

  it('finds folders by name, the ones holding a backup, and their paths', async () => {
    const drive = fakeDrive()
    vi.stubGlobal('fetch', drive.fetch)
    const t = tokens()
    const browse = driveFolders(t.source)
    const family = await browse.create('root', 'Family')
    const health = await browse.create(family.id, 'Health records')
    await browse.create('root', 'Photos')
    await googleDrive(t.source, 'Drive', health.id).write('hearth-backup.hearth', sealed('web'))

    expect((await browse.search('Health')).map((f) => f.name)).toEqual(['Health records'])
    expect(await browse.withBackup('hearth-backup.hearth')).toEqual([health])
    expect((await browse.path(health.id)).map((f) => f.name)).toEqual(['Family', 'Health records'])
    expect(await driveAccount(t.source)).toBe('someone@hearth.example')
  })

  it('asks for a new sign-in when even a fresh token is refused', async () => {
    vi.stubGlobal('fetch', async () => json({}, 401))
    const dir = googleDrive(tokens().source, 'Google Drive (me)')
    await expect(dir.names()).rejects.toBeInstanceOf(SignInNeeded)
  })
})

describe('Dropbox backups', () => {
  it('writes, lists and reads in the app folder', async () => {
    const box = fakeDropbox()
    vi.stubGlobal('fetch', box.fetch)
    const dir = dropbox(tokens().source, 'Dropbox (me)')
    await writeSnapshot(dir, 'hearth-backup.hearth', sealed('one'), 'https://hearth.example')
    await writeSnapshot(dir, 'hearth-backup.hearth', sealed('two'), 'https://hearth.example')
    expect([...box.files.keys()].sort()).toEqual(['/README.txt', '/hearth-backup.hearth'])
    expect(text(await dir.read('hearth-backup.hearth'))).toBe('HRTH2two')
    expect(await dir.read('missing')).toBeNull()
  })

  it('creates the attachments folder on demand and deletes it whole', async () => {
    const box = fakeDropbox()
    vi.stubGlobal('fetch', box.fetch)
    const dir = dropbox(tokens().source, 'Dropbox (me)')
    expect(await dir.subdir('attachments')).toBeNull()
    const sub = await dir.subdir('attachments', true)
    await sub?.write('abc.att', new TextEncoder().encode('HRTH1doc'))
    expect(box.files.has('/attachments/abc.att')).toBe(true)
    expect(await sub?.names()).toEqual(['abc.att'])
    await dir.remove('attachments')
    expect(box.folders.has('/attachments')).toBe(false)
  })

  it('escapes non-ASCII names in the argument header', async () => {
    const box = fakeDropbox()
    vi.stubGlobal('fetch', box.fetch)
    await dropbox(tokens().source, 'Dropbox').write('résumé.hearth', sealed('x'))
    expect(box.files.has('/résumé.hearth')).toBe(true)
  })
})
