import { type CloudProvider, type CloudRequest, cloudRequest } from '../egress/egress'
import type { Dir } from './folder'

/**
 * Google Drive and Dropbox as a backup folder (docs/decisions/0009-cloud-drive-buttons.md).
 *
 * The same `Dir` the browser folder and the phone picker give, over each provider's REST API. The
 * native shell signs the user in and hands the page short-lived access tokens only; the refresh
 * token never enters the page. Every call goes through `cloudRequest` in egress.ts, which refuses
 * any host but the provider's API.
 *
 * On Drive the user chooses the folder (`driveFolders` backs the chooser), which needs the full
 * `drive` scope: Hearth can see the whole Drive but reads and writes only in that folder. Without a
 * choice it uses a `Hearth` folder in My Drive. Dropbox keeps to its app folder (`Apps/<app name>`).
 */

/** Where a fresh access token comes from; `fresh` skips a cached one that the provider refused. */
export type TokenSource = (fresh: boolean) => Promise<string>

/** The provider refused the grant: the user has to sign in again. */
export class SignInNeeded extends Error {
  constructor(provider: CloudProvider) {
    super(`${provider === 'google' ? 'Google Drive' : 'Dropbox'} needs you to sign in again`)
  }
}

type Call = Omit<CloudRequest, 'provider' | 'token'>

/** One authorised call, retried once with a fresh token when the cached one has expired. */
async function send(provider: CloudProvider, token: TokenSource, req: Call): Promise<Response> {
  let res = await cloudRequest({ ...req, provider, token: await token(false) })
  if (res.status === 401) res = await cloudRequest({ ...req, provider, token: await token(true) })
  if (res.status === 401) throw new SignInNeeded(provider)
  return res
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed (${res.status})`)
  return res
}

const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer())

// ---- Google Drive ---------------------------------------------------------------------------

const DRIVE = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about'
const FOLDER = 'application/vnd.google-apps.folder'
const ROOT_NAME = 'Hearth'

interface DriveEntry {
  id: string
  name: string
  mimeType: string
}

/** Drive's query language quotes with single quotes and escapes with a backslash. */
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** A folder in the user's Drive, as the chooser shows it. */
export interface DriveFolder {
  id: string
  name: string
}

/** Who signed in, from Drive itself: Play services does not always say. */
export async function driveAccount(token: TokenSource): Promise<string> {
  const call = (req: Call) => send('google', token, req)
  const res = await ok(
    await call({ method: 'GET', url: `${DRIVE_ABOUT}?fields=${encodeURIComponent('user(emailAddress)')}` }),
    'asking Google Drive who signed in',
  )
  return ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? ''
}

/**
 * What the Drive folder chooser needs: the folders inside one (the tree), folders by name (the
 * search), the folders that already hold a Hearth backup, each one's path, and a new folder.
 * `root` is My Drive.
 */
export function driveFolders(token: TokenSource) {
  const call = (req: Call) => send('google', token, req)
  interface Node extends DriveFolder {
    parents?: string[]
  }
  /** Names and parents already fetched, so paths cost one request per unseen folder. */
  const nodes = new Map<string, Node>()
  let myDrive: Promise<string> | null = null

  async function query(q: string, fields: string, extra = ''): Promise<Node[]> {
    const out: Node[] = []
    let page = ''
    do {
      const res = await ok(
        await call({
          method: 'GET',
          url: `${DRIVE}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`nextPageToken,files(${fields})`)}&pageSize=1000&spaces=drive${extra}${page && `&pageToken=${page}`}`,
        }),
        'listing Google Drive folders',
      )
      const body = (await res.json()) as { files: Node[]; nextPageToken?: string }
      out.push(...body.files.map(({ id, name, parents }) => ({ id, name, parents })))
      page = body.nextPageToken ?? ''
    } while (page)
    for (const n of out) nodes.set(n.id, n)
    return out
  }

  async function node(id: string): Promise<Node | null> {
    const known = nodes.get(id)
    if (known) return known
    const res = await call({
      method: 'GET',
      url: `${DRIVE}/${id}?fields=${encodeURIComponent('id,name,parents')}`,
    })
    if (!res.ok) return null
    const n = (await res.json()) as Node
    nodes.set(n.id, n)
    return n
  }

  const onlyFolders = `mimeType = '${FOLDER}' and trashed = false`
  const plain = (list: Node[]): DriveFolder[] => list.map(({ id, name }) => ({ id, name }))

  return {
    list: async (parent: string) =>
      plain(
        await query(`${quote(parent)} in parents and ${onlyFolders}`, 'id,name,parents', '&orderBy=name'),
      ),

    /** Folders whose name contains `text`, anywhere in the Drive; the first 50 by name. */
    async search(text: string): Promise<DriveFolder[]> {
      const found = await query(
        `name contains ${quote(text)} and ${onlyFolders}`,
        'id,name,parents',
        '&orderBy=name',
      )
      return plain(found.slice(0, 50))
    },

    /** Folders that already hold `snapshot`: the backup made on another device is one tap away. */
    async withBackup(snapshot: string): Promise<DriveFolder[]> {
      const files = await query(`name = ${quote(snapshot)} and trashed = false`, 'id,name,parents')
      const ids = [...new Set(files.flatMap((f) => f.parents ?? []))]
      return plain((await Promise.all(ids.map(node))).filter((n): n is Node => n !== null))
    },

    /** The folders above `id`, from My Drive down, the folder itself last. */
    async path(id: string): Promise<DriveFolder[]> {
      myDrive ??= node('root').then((r) => r?.id ?? 'root')
      const top = await myDrive
      const out: DriveFolder[] = []
      let at: Node | null = await node(id)
      while (at && out.length < 30) {
        out.unshift({ id: at.id, name: at.name })
        const up = at.parents?.[0]
        if (!up || up === top) break
        at = await node(up)
      }
      return out
    },

    create: async (parent: string, name: string): Promise<DriveFolder> => ({
      id: await makeFolder(call, name, parent),
      name,
    }),
  }
}

async function makeFolder(
  call: (req: Call) => Promise<Response>,
  name: string,
  parent: string,
): Promise<string> {
  const res = await ok(
    await call({
      method: 'POST',
      url: `${DRIVE}?fields=id`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    }),
    'creating a Google Drive folder',
  )
  return ((await res.json()) as { id: string }).id
}

/** Backups in the Drive folder `folderId`, or in a `Hearth` folder in My Drive when none was chosen. */
export function googleDrive(token: TokenSource, label: string, folderId?: string): Dir {
  const call = (req: Call) => send('google', token, req)

  async function children(parent: string): Promise<DriveEntry[]> {
    const out: DriveEntry[] = []
    let page = ''
    do {
      const q = encodeURIComponent(`${quote(parent)} in parents and trashed = false`)
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType)')
      const res = await ok(
        await call({
          method: 'GET',
          url: `${DRIVE}?q=${q}&fields=${fields}&pageSize=1000&spaces=drive${page && `&pageToken=${page}`}`,
        }),
        'listing Google Drive',
      )
      const body = (await res.json()) as { files: DriveEntry[]; nextPageToken?: string }
      out.push(...body.files)
      page = body.nextPageToken ?? ''
    } while (page)
    return out
  }

  /** Two-step resumable upload: it has no size ceiling, unlike the 5 MB simple and multipart ones. */
  async function upload(existing: string | null, name: string, parent: string, body: Uint8Array | string) {
    const start = await ok(
      await call({
        method: existing ? 'PATCH' : 'POST',
        url: `${DRIVE_UPLOAD}${existing ? `/${existing}` : ''}?uploadType=resumable`,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(existing ? {} : { name, parents: [parent] }),
      }),
      `starting the upload of ${name}`,
    )
    const session = start.headers.get('location')
    if (!session) throw new Error('Google Drive did not return an upload address')
    await ok(await call({ method: 'PUT', url: session, body }), `uploading ${name}`)
  }

  function dir(name: string, id: () => Promise<string>): Dir {
    // Name → entry, refreshed by every listing. A folder rarely holds more than a few hundred
    // files, and looking a name up costs one listing either way.
    let known: Map<string, DriveEntry> | null = null
    const entries = async () => {
      known = new Map((await children(await id())).map((e) => [e.name, e]))
      return known
    }
    const find = async (child: string) => known?.get(child) ?? (await entries()).get(child)

    return {
      name,
      single: false,
      versioned: true,
      names: async () => [...(await entries()).keys()],
      async read(child) {
        const e = await find(child)
        if (!e || e.mimeType === FOLDER) return null
        const res = await call({ method: 'GET', url: `${DRIVE}/${e.id}?alt=media` })
        if (res.status === 404) return null
        return bytesOf(await ok(res, `reading ${child}`))
      },
      async readHead(child, bytes) {
        const e = await find(child)
        if (!e || e.mimeType === FOLDER) return null
        const res = await call({
          method: 'GET',
          url: `${DRIVE}/${e.id}?alt=media`,
          headers: { range: `bytes=0-${bytes - 1}` },
        })
        if (res.status === 404) return null
        return bytesOf(await ok(res, `reading ${child}`))
      },
      async write(child, bytes) {
        const e = await find(child)
        await upload(e && e.mimeType !== FOLDER ? e.id : null, child, await id(), bytes)
        known = null
      },
      async remove(child) {
        const e = await find(child)
        if (!e) return
        // To the bin, not gone: Drive keeps it for 30 days, which is the undo the user expects.
        await ok(
          await call({
            method: 'PATCH',
            url: `${DRIVE}/${e.id}`,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ trashed: true }),
          }),
          `deleting ${child}`,
        )
        known?.delete(child)
      },
      async subdir(child, create = false) {
        const e = await find(child)
        if (e?.mimeType === FOLDER) return dir(child, async () => e.id)
        if (e || !create) return null
        const made = await makeFolder(call, child, await id())
        known = null
        return dir(child, async () => made)
      },
    }
  }

  if (folderId) return dir(label, async () => folderId)
  // The top folder is found (or made) on first use and then remembered for the page's lifetime.
  let root: Promise<string> | null = null
  const rootId = () => {
    root ??= (async () => {
      const top = (await children('root')).find((e) => e.name === ROOT_NAME && e.mimeType === FOLDER)
      return top?.id ?? (await makeFolder(call, ROOT_NAME, 'root'))
    })().catch((e) => {
      root = null
      throw e
    })
    return root
  }
  return dir(label, rootId)
}

// ---- Dropbox --------------------------------------------------------------------------------

const DBX_API = 'https://api.dropboxapi.com/2'
const DBX_CONTENT = 'https://content.dropboxapi.com/2'

/** Dropbox wants its JSON argument header in ASCII, with anything else escaped. */
const dropboxArg = (arg: object) =>
  JSON.stringify(arg).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

export function dropbox(token: TokenSource, label: string): Dir {
  const call = (req: Call) => send('dropbox', token, req)
  const rpc = (endpoint: string, arg: object) =>
    call({
      method: 'POST',
      url: `${DBX_API}/${endpoint}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(arg),
    })
  /** 409 is Dropbox's "the path is not there" (and every other request-level refusal). */
  const missing = (res: Response) => res.status === 409

  function dir(name: string, path: string): Dir {
    const at = (child: string) => `${path}/${child}`
    return {
      name,
      single: false,
      versioned: true,
      async names() {
        let res = await rpc('files/list_folder', { path, limit: 2000 })
        if (missing(res)) return []
        const out: string[] = []
        for (;;) {
          const body = (await (await ok(res, 'listing Dropbox')).json()) as {
            entries: { name: string }[]
            cursor: string
            has_more: boolean
          }
          out.push(...body.entries.map((e) => e.name))
          if (!body.has_more) return out
          res = await rpc('files/list_folder/continue', { cursor: body.cursor })
        }
      },
      async read(child) {
        const res = await call({
          method: 'POST',
          url: `${DBX_CONTENT}/files/download`,
          headers: { 'dropbox-api-arg': dropboxArg({ path: at(child) }) },
        })
        if (missing(res)) return null
        return bytesOf(await ok(res, `reading ${child}`))
      },
      async readHead(child, bytes) {
        const res = await call({
          method: 'POST',
          url: `${DBX_CONTENT}/files/download`,
          headers: { 'dropbox-api-arg': dropboxArg({ path: at(child) }), range: `bytes=0-${bytes - 1}` },
        })
        if (missing(res)) return null
        return bytesOf(await ok(res, `reading ${child}`))
      },
      async write(child, bytes) {
        await ok(
          await call({
            method: 'POST',
            url: `${DBX_CONTENT}/files/upload`,
            headers: {
              'content-type': 'application/octet-stream',
              'dropbox-api-arg': dropboxArg({ path: at(child), mode: 'overwrite', mute: true }),
            },
            body: bytes,
          }),
          `uploading ${child}`,
        )
      },
      async remove(child) {
        const res = await rpc('files/delete_v2', { path: at(child) })
        if (!missing(res)) await ok(res, `deleting ${child}`)
      },
      async subdir(child, create = false) {
        const res = await rpc('files/get_metadata', { path: at(child) })
        if (res.ok) {
          const meta = (await res.json()) as { '.tag': string }
          return meta['.tag'] === 'folder' ? dir(child, at(child)) : null
        }
        if (!missing(res)) await ok(res, `opening ${child}`)
        if (!create) return null
        await ok(
          await rpc('files/create_folder_v2', { path: at(child), autorename: false }),
          `creating ${child}`,
        )
        return dir(child, at(child))
      },
    }
  }
  // The app folder's root is the empty path.
  return dir(label, '')
}
