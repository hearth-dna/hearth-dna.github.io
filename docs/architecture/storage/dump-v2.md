# Dump v2: one container for backups, archives and manual export

Dump v1 (`export/dump.ts`) is a gzipped JSON with genotypes as a string table, optionally
wrapped in an AES-GCM envelope. It works, and it stays importable forever. Three things push a v2:

1. **Autosave needs cheap rebuilds.** v1 pulls every genotype to the main thread on each export.
2. **Conflict detection needs a readable header** on an encrypted file.
3. **Genomes are immutable per source file**; re-serialising them on every save is waste, and
   keeping the original provider file lets the user re-import into any other tool (design §6.5
   already promised raw export).

## Container

A zip (fflate is already a dependency; the browser's `CompressionStream` has no zip mode):

```
hearth-dump-<date>.hearth            ← zip, optionally inside the encryption envelope (then .hearth.enc)
├── manifest.json                    ← {format:"hearth-dump", version:2, app_version, exported_at,
│                                       generation, device, profile, entries:[{path, sha256, bytes}]}
├── journal.json                     ← persons, relationships, source_files, consents,
│                                       health_log, notes, chats, sharing_log (small, changes often)
└── genomes/<sha256>.txt.gz          ← the original provider file, gzipped, one per source_file
```

- `genomes/*` entries are stored (not deflated) since they are already gzipped; the zip is just a
  directory. `path` is `genomes/<sha256 of the gzipped bytes>.txt.gz`; the manifest entry carries
  the person, source_file id, provider, build and whether it is the original or reconstructed. Import re-runs the provider parser, which is the same code as a first import, so a
  v2 restore is as trustworthy as the original upload and the tests already exist.
- `journal.json` is deflated. It is the whole of v1 minus `snp_index`/`genotypes`.
- `manifest.entries` hashes let a restore verify integrity before touching the database.

### Header for encrypted files

The v1 envelope is `HRTH1 | salt | nonce | ciphertext`. v2 is
`HRTH2 | u16 header_len | header JSON | salt | nonce | ciphertext` where the header JSON is
`{version:2, generation, device, exported_at, encrypted:true}` and nothing else. The same
header, with `encrypted:false`, is also the first entry of the zip so a plaintext file can be
identified by reading its first bytes too. `readHeader(bytes)` handles both without a passphrase.

## New `meta` keys

- `device`: random UUID generated on first open of a profile. Identifies the browser profile in
  headers; not derived from hardware.
- `generation`: integer, incremented by the worker on every write transaction that the UI
  reports as a change (import, health log, note, chat, consent). The backup scheduler reads it;
  a restore sets it to `max(local, restored) + 1`.

## Cost model

| Event | v1 export work | v2 export work |
|---|---|---|
| Health-log edit, autosave | read 5M rows to main thread, build string table, gzip (~10 s) | write journal (~50 KB), copy cached genome blobs by reference (~ms) |
| Genome import | same as above | gzip the uploaded file once, cache it |
| Manual dump | same as above | same as autosave |

Genome blobs are cached in OPFS under a separate directory (`hearth-<profile>-files/`, file name
`genome-<sha256 of the text>.gz`), written at import time and on restore, keyed by the sha256 the
`source_file` row already stores. `pruneGenomeBlobs` drops orphans after delete, revoke and erase. Not a SQLite
table, so ADR 0001's "no blob tables" spirit holds and the SAH pool directory stays untouched.
When a person or source file is deleted the blob goes with it (same revoke path). If a blob is
missing (imported before v2), the worker reconstructs a provider-style text from the genotype
table with `group_concat` in SQL, never materialising rows in JS, and caches the result.

## Import

`deserialise` sniffs: `HRTH2` → v2 envelope; `HRTH1` → v1 envelope; `PK` → plaintext v2 zip;
gzip magic → plaintext v1. v1 continues to import through `expandDump`. v2 imports journal first
(inside one transaction), then each genome through `importCalls` with progress, then sets
`generation`. Import from a `.html` archive extracts the data block and continues the same way.

## Migration and compatibility

- Export writes v2 from the day it ships; the file name is `hearth-dump-<date>.hearth`
  (`.enc` suffix kept for encrypted). The Settings copy explains that older Hearth versions
  cannot read it and that v1 files still import.
- The portable archive embeds v2 only.
- Tests: `dump.test.ts` keeps v1 round-trips; a new `dumpV2.test.ts` covers manifest hashing,
  header sniffing for all four prefixes, tampered-entry rejection, and a v1 → import → v2 export
  equality check on persons/relationships/health log.

## As built

- `meta.device` is set at first open; the worker bumps `meta.generation` after every INSERT,
  UPDATE or DELETE outside `meta`, and `Database.onChange` fires on the main thread.
- `export/container.ts` builds and opens the zip and the `HRTH2` envelope; `dump.ts` stays as the
  v1 reader (`HRTH1` envelope, gzip JSON).
- `export/snapshot.ts` collects the journal and genome blobs (cached originals, else one
  reconstructed file per person built in the worker); `export/restore.ts` imports v2, v1 and
  `.html` archives as a union by id, loading genotypes only for people who had none.
- Restoring a consent or sharing-log row is idempotent (`WHERE NOT EXISTS`), so loading the same
  file twice adds nothing.
