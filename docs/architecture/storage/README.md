# Storage and transfer: keeping data without keeping it on a server

Hearth stores nothing server-side (ADR 0001). That leaves the user with one question the app has
to answer well: **where does my data live, how do I not lose it, and how do I get it onto another
PC?** Today the only answer is the manual dump in Settings. This folder designs the next answers.

Status: **implemented** (2026-09-14). Each document ends with where the code lives.

| Document | Covers |
|---|---|
| [`backup-folder.md`](backup-folder.md) | A user-chosen folder (USB stick, Google Drive / Dropbox / OneDrive synced folder) the app writes backups to and restores from. The primary mechanism. On the phones, a folder or single file from the system picker (ADR 0008). |
| [`portable-archive.md`](portable-archive.md) | One self-contained `hearth-<date>.html` that *is* the app plus the data: double-click it anywhere, browse, save a new copy. |
| [`cloud-drives.md`](cloud-drives.md) | Google Drive and friends: why the synced-folder route is chosen over a Drive API integration, and what an API integration would cost if it is ever wanted. |
| [`open-formats.md`](open-formats.md) | CSV and JSON Lines exports of genotypes, findings and the health log for the user's own spreadsheets and scripts. |
| [`dump-v2.md`](dump-v2.md) | Changes to the dump container that the three above need: generation counter, per-genome blobs, one envelope for encryption. |

## Options considered

| Option | Data lives | Works offline | Second PC | Browser support | Trust surface added | Verdict |
|---|---|---|---|---|---|---|
| Manual dump download / upload (today) | browser OPFS + a file the user manages | yes | copy the file | all | none | keep as the universal fallback |
| **Backup folder** (File System Access API) | OPFS + a folder the user picked | yes | folder is on a USB stick or in a synced cloud folder | Chromium desktop only; others fall back to manual dump | none: no network, no third-party code | **build first** |
| **Portable archive** (single HTML file) | inside the file itself | yes | copy the file; needs only a browser | all desktop browsers (spike needed for Safari) | none | **build second** |
| Google Drive API (OAuth in browser) | Drive `appDataFolder` | no | automatic | all | Google's script on our page, new CSP origins, OAuth client id, Google app verification | deferred, see `cloud-drives.md` |
| Native launcher (Go binary on the USB serving the PWA on localhost) | folder next to the binary | yes | copy the folder | any browser | unsigned executable warnings on every OS | rejected for now; the HTML archive gives the same result without an executable |
| Operator-run encrypted sync (design §11.4) | our bucket, ciphertext | no | automatic | all | accounts, a bucket, a key-loss story | unchanged: phase 5, not before the above exist |

## Decisions

1. **Files are the sync layer.** The app never talks to a cloud storage provider. It writes to a
   folder; whatever syncs that folder (Google Drive for desktop, Dropbox, OneDrive, iCloud Drive,
   Syncthing, or a USB stick carried by hand) is the user's choice and the user's contract. This
   keeps the egress rule intact: `egress.ts` gains nothing, the CSP gains nothing.
2. **Anything that leaves the browser profile is encrypted unless the user explicitly says
   otherwise.** Backup folder and portable archive both default to a passphrase. A plaintext
   choice shows the same warning the dump does today (design §13.1).
3. **One container format for all three** (`dump-v2.md`): the manual dump, the backup folder
   file and the payload inside the portable archive are the same bytes. Import code exists once.
4. **Snapshots, not merges.** A backup file is a full snapshot with a `generation` counter and a
   `device` id. Two PCs editing the same folder is detected and surfaced ("the folder has a newer
   backup than the one you loaded"), never silently overwritten. Field-level merge is a later
   problem (design §11.4).
5. **Portable archive is read-mostly.** It opens with an in-memory database, so nothing persists
   in the browser it was opened in; edits are kept by "Save archive", which writes a new file. That
   is the TiddlyWiki model and it is easy to explain.

## Where things are

| Piece | Code |
|---|---|
| Container, header, envelope | `frontend/src/export/container.ts` (+ test) |
| Snapshot from the live database | `frontend/src/export/snapshot.ts` |
| Restore of v2, v1 and `.html` archives | `frontend/src/export/restore.ts` |
| Genome file cache, generation counter | `frontend/src/db/db.worker.ts`, `db.ts` |
| Backup folder | `frontend/src/backup/` (naming + test, folder, native + test, scheduler), `components/BackupCard.tsx`; phones: `mobile/android/.../Files.kt`, `mobile/ios/Hearth/NativeFiles.swift` |
| Portable archive | `frontend/src/archive/` (payload + test, mode, worker), `archive.html`, `vite.archive.config.ts`, `components/ArchiveCard.tsx` |

Revisit `cloud-drives.md` only if users ask for a browser-only Drive path on a machine where they
cannot install the Drive desktop client.
