// Only reachable from the archive build (mode.ts imports it behind __HEARTH_ARCHIVE__): the
// database worker as a Blob-URL worker and sqlite3.wasm as a data: URL, so nothing has to be
// fetched from a file:// sibling.
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url'
import DbWorker from '../db/db.worker.ts?worker&inline'

export const makeWorker = () => new DbWorker()
export { wasmUrl }
