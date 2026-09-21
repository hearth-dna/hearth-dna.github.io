# Backup folder: USB sticks and synced cloud folders

## What the user sees

Settings gains a **Backup folder** card:

- *Choose folder…* opens the browser's directory picker. The user points it at `E:\hearth` on a
  USB stick, or at `~/Google Drive/hearth`, `~/Dropbox/hearth`, and so on.
- After choosing, the card shows the folder name, the passphrase field (required unless "store
  unencrypted" is ticked, with the existing plaintext warning), the time of the last backup and a
  *Back up now* button.
- **Autosave** is on by default once a folder is chosen: every change (import, health-log entry,
  note, consent) schedules a backup after a short quiet period.
- **Restore**: if a chosen folder already contains a backup newer than what this browser has, the
  card offers *Load from folder*. The same button is how a second PC gets the data: install the
  PWA, choose the same folder, load.
- The folder is remembered across launches. On the next launch Chrome asks once whether to allow
  access again (or not at all after the user picks "Allow on every visit", Chrome 122+); until it
  is re-granted the card shows *Reconnect folder*.

Browsers without the directory picker (Firefox, Safari, all mobile) see the card with one line:
"Your browser cannot write to a folder on its own; use Export dump and Import dump" and the
existing buttons. Feature detection is `'showDirectoryPicker' in window`.

## Layout in the folder

```
<folder>/
  hearth-backup.hearth        ← current snapshot (see dump-v2.md)
  hearth-backup.hearth.1      ← previous snapshot
  hearth-backup.hearth.2      ← the one before (ROTATIONS = 3)
  attachments/<sha256>.att    ← one per document attached to a health log entry
  README.txt                  ← "This folder is written by Hearth (<url>). Files are encrypted
                                 with your passphrase / plaintext. Open <url> and choose this
                                 folder to restore."
```

Rotation is by copy (handles on removable media cannot be renamed portably), oldest first, and
only then is the current file overwritten, so a crash mid-write leaves `.1` intact and the
truncated current file fails to open rather than silently restoring something partial.

Multiple families on one stick: the profile name is part of the file name only when the profile
is not `default` (`hearth-backup-<profile>.hearth`), so the common case stays tidy. The
attachments folder follows the same rule (`attachments-<profile>/`), so *Forget folder → delete
files* never takes the other family's documents with it.

**Attachments are sidecars, not snapshot content.** The snapshot is rewritten in full every few
seconds and kept in three rotations; documents inside it would be copied four times over on every
edit, which is why the journal carries only the `attachment` rows and the bytes sit beside it.
Each file is named after the sha256 of its content and written once:

- Content addressing means two computers writing the same name write the same bytes, so a sidecar
  cannot conflict the way the snapshot can. The conflict path mirrors as usual.
- The set to write is recomputed each run as `wanted − present` (`attachments/sidecar.ts`), so a
  reformatted stick, a cloud client that dropped a file, or documents attached while the folder
  was unreachable all heal on the next backup. A run copies at most 25 files or 100 MB and
  continues on the next one, so an autosave never sits on the folder for minutes.
- Sidecars are never rotated and never deleted, even when the entry goes: the rotated snapshots
  beside them may still refer to the document. They go when the user forgets the folder and asks
  for its files to be deleted. `README.txt` says so.
- Encryption matches the snapshot: each file is the same `HRTH1` envelope used by the dump, with
  one PBKDF2 derivation per run rather than per file (600 k iterations × a hundred documents
  would block the tab for a minute). With *store unencrypted* the raw original is written, which
  also makes the folder readable as an ordinary archive of documents.
- Pulling back (`loadFromFolder`, or *Fetch documents*) hashes every file again before storing it:
  the name is a claim about the content, and a folder is something other programs can write to.
  A row whose bytes are nowhere shows in the log as "not on this device" rather than failing.

## Behaviour details

**Handle persistence.** `FileSystemDirectoryHandle` is structured-cloneable; it is stored in a
tiny IndexedDB database (`hearth-handles`, one record per profile). This is the one place outside
SQLite the app keeps state, because a handle cannot be put in SQLite. On launch:
`handle.queryPermission({mode:'readwrite'})` → if `'granted'`, autosave is live; if `'prompt'`,
show *Reconnect folder* which calls `requestPermission` (must run from a click).

**Autosave.** `backup/scheduler.ts` subscribes to `Database.onChange`, debounces 5 s, then builds
the container and writes. Only a write that changed rows counts, so startup cleanups do not. A
switch in the card turns it off (`Saved.auto`, default on). Whether the folder is behind is known
from `meta.generation` against the generation last written or loaded; when it is, and automatic
sync is on, the next start or reconnect syncs without waiting for another edit.

**Header Sync button.** `components/SyncButton.tsx` shows the state in a word and a colour:
synced (with the time), syncing soon, not synced, syncing, newer copy on another computer,
passphrase needed, reconnect, conflict, failed. A click syncs: a newer copy is loaded first (a
union by id, so nothing here is lost), then this browser's state is written. States that need a
decision open Settings. Folder reads time out after 10 s, so a stuck cloud mount shows "Sync
failed" instead of blocking the app.

**Cost.** A full backup of seven genomes is ~5 MB compressed. Building it today means pulling
every genotype to the main thread; `dump-v2.md` moves genotype serialisation into the worker and
caches per-source-file blobs, so an autosave after a health-log edit costs milliseconds, not
seconds. Until that lands autosave is fine but noticeably slow after an import; acceptable for
the first cut, and the reason dump v2 is step 1.

**Conflict detection.** Before overwriting, read the header of the current folder file (the
first few hundred bytes are plaintext: format, generation, device, exported_at, even when the
payload is encrypted). If its `generation` is not the one this browser last wrote or loaded, and
its `device` differs, do not overwrite: write `hearth-backup.conflict-<device>-<date>.hearth` and show
"Another computer saved a newer backup. Load theirs, or keep yours?" Choosing *keep yours* writes
the current file. This is last-writer-wins with a visible seam, which is what a family sharing a
stick or a Drive folder actually needs.

**Synced-folder specifics.** Google Drive for desktop, Dropbox and OneDrive all sync a rewritten
file within seconds; a 5 MB file is trivial. Two clients writing the same path concurrently
produce a provider "conflicted copy"; the generation header makes those diagnosable. The
`README.txt` never contains personal data. The app does not detect what syncs the folder and
does not need to.

**Genetic data on removable media.** The default passphrase requirement is the mitigation. The
consent table gets one new kind, `backup_folder` (version 1, subject = folder name, never the
path), granted when a folder is chosen; revoking forgets the handle and offers to delete the
backup files in the folder (best effort, then tells the user to check the stick).

## Security

- No network. The File System Access API is a user-gesture, per-origin permission; nothing else
  can read the handle.
- Files are the dump v2 envelope: AES-GCM, PBKDF2 600k (already in `dump.ts`). Header fields
  outside the ciphertext are format, version, generation, device id (random UUID, not a machine
  identifier), export time and whether the payload is encrypted. No names, no counts.
- Sidecar names are content hashes and carry no file names: the document's own name, its type and
  its size live only in the `attachment` row, inside the encrypted snapshot. Someone who finds the
  stick learns how many documents exist and their hashes — enough to confirm possession of a file
  they already hold, not to learn anything new.
- The passphrase lives in `sessionStorage` (this tab, until it closes); autosave requires it to
  have been entered once since launch. If it has not, the card shows *Enter passphrase to resume
  backups* instead of silently doing nothing.

## As built

- `backup/naming.ts` (pure, tested): file names, rotation plan, conflict name, `isForeign`,
  `hasNewer`. `backup/folder.ts`: picker, IndexedDB handle store, permissions, read/write/rotate.
  `backup/scheduler.ts`: the app-wide `backups` singleton the card renders.
- `attachments/{sidecar,crypto,mirror}.ts`: sidecar naming and the diff (pure, tested), the
  per-run seal/open, and the push/pull the scheduler calls after a snapshot and after a restore.
- Consent kind `backup_folder` (still version 1: mirroring encrypted documents beside the snapshot
  is the promise it already makes); *Forget folder* revokes it and offers to delete the snapshots
  and the attachments folder.
- Not exercised end to end in this session: the directory picker needs a real click in a real
  Chromium window, so choose a temporary folder and try *Back up now* / *Load from folder* by hand.
