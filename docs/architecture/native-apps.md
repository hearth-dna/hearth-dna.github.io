# Native apps

How the Compose (Android) and SwiftUI (iOS) apps are put together, and what each screen must do.
The decision and its staging are [ADR 0010](../decisions/0010-native-apps.md). The web app remains
the reference for behaviour: when this page and `frontend/` disagree, `frontend/` is right and this
page is out of date.

## Layers (the same on both platforms)

| Layer | Android (`mobile/android/app/src/main/kotlin/com/hearth/`) | iOS (`mobile/ios/Hearth/Native/`) |
| --- | --- | --- |
| Database | `data/Db.kt`: framework `SQLiteOpenHelper`, `user.db` in app-private storage | `Data/Db.swift`: `libsqlite3`, `user.db` in Application Support, excluded from iCloud backup |
| Schema | `data/Schema.kt`: `SCHEMA_SQL` copied verbatim from `frontend/src/db/schema.ts`; a unit test compares them | `Data/Schema.swift`, same test |
| SQL seam | `data/Sql.kt`: the interface `Db` implements on the phone and a JDBC SQLite implements in JVM tests | — (tests use an in-memory `Db`) |
| Repository | `data/Repo.kt`: people, pedigree, genotypes, health log, attachments, consents, sharing log, meta; every write that changes rows bumps `meta.generation` | `Data/Repo.swift` |
| Files beside the database | `data/Blobs.kt`: genome originals (`genome-<sha>.gz`), rebuilt genomes, attachments (`att-<sha>.bin`) | `Data/Blobs.swift` |
| Pure logic | `genome/`, `kb/`, `family/`, `ask/`, `health/`, `documents/`, `attachments/`, `export/`: one file per `frontend/src` module, each tested like it | the same groups, capitalised |
| Backups | `backup/`: dump v2 read and write, v1 read, restore, `Dir` places (SAF, Drive, Dropbox), the scheduler | `Backup/` (plus iCloud) |
| Network | `Egress.kt`, the only file that opens a connection (`EgressTest`) | `Egress.swift` (`EgressTests`) |
| Strings | `i18n/Strings.kt`: the web JSON from assets, a language chosen in Settings | `I18n/Strings.swift` |
| Screens | `ui/…` Compose + Material 3; `MainActivity` | `UI/…` SwiftUI |

## Screens

Five tabs, the web's (TabBar.tsx): **People**, **Lookup**, **Health**, **Ask**, **Settings**.

- **People** (PeoplePage.tsx): cards, table or pedigree tree; add and edit a person; parent links;
  import a DNA file for one person or several at once, behind the `import_genome` consent (and
  `import_minor` with the guardian statement for someone under 18). A person's **report**
  (PersonPage.tsx) shows their files, the Mendelian check against each parent and the trio, a way
  into their health log, and the knowledge-base findings, sortable.
- **Lookup** (FamilyPage.tsx): search the kb by gene, drug, condition or rsid; every person's
  genotype at it, and who inherited which allele (the pedigree with the allele on each line, risk
  alleles marked, ambiguous lines dashed, impossible ones red).
- **Health**: the log below, plus a quick measurement row, attachments (kept in the app, viewed in
  the app, never handed to another app) and **Read a document** with the user's own Gemini key
  (key in the Keystore / Keychain, the `read_document_byok` consent, a confirmation per send, a
  sharing-log row with metadata only; the reply is a draft for the add form).
- **Ask** (AskPage.tsx): the question classified on the phone, suggested records with reasons,
  search for more, the context pack previewed exactly as copied (character for character the
  web's), copy to the clipboard after a confirmation, logged in the sharing log.
- **Settings** (SettingsPage.tsx): language; full dump export and import; the backup place;
  open formats (CSV, JSON Lines); the Gemini key; consents with revoke (revoking deletes what the
  consent covered); the sharing log; erase everything. A sync status sits in the top bars.

### Backups

The web's rules (`frontend/src/backup/scheduler.ts`, `docs/architecture/storage/backup-folder.md`):
the snapshot after every change (debounced 5 s), newer data in the place loaded first (at start,
on returning to the foreground, before every backup), genomes and sealed document copies beside a
folder snapshot, rotations where the place does not version files itself. Places: a folder or a
single file from the system picker, Google Drive or Dropbox (ADR 0009), and iCloud Drive on iOS.
The passphrase is kept in the Keystore / Keychain under the name the web shell used.

## Formats the native code must match exactly

- **Schema**: `frontend/src/db/schema.ts`. Ids are random UUIDs (`crypto.randomUUID()` form),
  timestamps ISO 8601 UTC with milliseconds (`2026-09-21T10:00:00.000Z`), dates `YYYY-MM-DD`,
  times `HH:MM` or `''`. Health log `tags` is `formatTags(parseTags(text))`: lower-case, trimmed,
  de-duplicated, joined with `', '`.
- **Dump v2** (`docs/architecture/storage/dump-v2.md`, `frontend/src/export/container.ts`):
  - A plain file is a zip holding `header.json`, `manifest.json` and `journal.json`, plus genome
    entries.
  - An encrypted file is `HRTH2`, then a 2-byte big-endian header length, the plaintext header
    JSON, a 16-byte salt, a 12-byte nonce, and AES-256-GCM ciphertext of the zip (16-byte tag at
    the end). The key is PBKDF2-HMAC-SHA256 with 600 000 iterations.
  - The header needs `format == "hearth-dump"` and `version == 2`.
- **Journal rows** are raw SQL rows (snake_case columns), with two exceptions written in
  camelCase: `relationships` (`{parentId, childId}`) and `consents`
  (`{kind, version, subject, grantedAt}`; a row with `revokedAt` is skipped).
- **Restore merges, it does not replace**: `INSERT OR IGNORE` per row, with column names taken from
  the allowlists in `frontend/src/export/restore.ts` and never from the file. Health rows get the
  defaults from `withDefaults()`. An attachment row whose entry is absent is skipped, and a consent
  is inserted only when no row with the same `(kind, version, subject)` exists.
- **Genomes and documents**: a restore loads a genome only for someone with no genotypes yet, and
  keeps an original as a blob; attachment bytes travel beside a folder backup, never inside the
  snapshot, and are fetched from it.
- **Fixtures**: `mobile/fixtures/` (see its README). Every restore test opens `plain.hearth` and
  `encrypted.hearth` and compares the database with `journal.json`.

## Health log screen

The same features on both platforms, each drawn with its own platform's components:

- **Scope**: a row of person chips, "Everyone" first (`healthPage.everyone`), then each person.
- **Search** over title, body, body part, unit and tags (`filterHealthLog`). Android: a Material 3
  search field. iOS: `.searchable`.
- **Kind chips with counts** (`healthTable.allKinds`, `kind.*`), each kind in its own colour. The
  palette is in `frontend/src/styles.css` (`.kind-*`, light and dark).
- **Filters sheet** (a bottom sheet on Android, a sheet on iOS):
  - body part, tag and minimum severity (the person is the scope row above, not repeated here);
  - from/to dates, plus period presets of 7, 30 and 90 days and 12 months;
  - Clear, and "Show N".
  - The button that opens it shows how many filters are on (`panelFilterCount`).
- **Active filter chips**, each removable, then "n of m" and a "clear" action.
- **Sort**: a menu of key (date, person, kind, title, value, body part, severity) and direction,
  starting in `HEALTH_SORT_DEFAULT_DIR`, with empty values last whatever the direction
  (`sortHealthLog`).
- **Views**: cards (default) and table. The choice is remembered.
  - Cards: sorted by date, they sit under day headers ("Today", "Yesterday", or a formatted date
    with the year only when it isn't the current year).
  - Each card shows a kind badge, the person (in the Everyone scope), the time, the title, the
    value large on the trailing side, then body part, severity (amber at 4 and above, red at 7 and
    above), a text marker and the attachment count, and the tags as chips. Tapping a tag filters
    by it.
  - Table: a horizontally scrolling grid with the web's columns. Tapping a header sorts by it.
- **Detail**: tapping an entry opens a sheet with every field, the full text, the attachment names,
  "transcribed by {model}" when `source` is set, and Delete (confirmed).
- **Add entry**: Android uses an extended FAB, iOS a toolbar `+`. The form is type-first, like
  `HealthEntryForm`:
  - pick the kind, then fill person, date (default today), time (default now), title, value and
    second value and unit for a measurement, body part, severity 1–10 or unrated, tags, and text.
  - The first entry for a person asks for `import_document` consent, showing the text in
    `consent.json`, and records it as the web does.
- **First launch**: the `first_launch` consent, with statement 1 in the phone's own wording
  (`native.firstLaunchStorage`) because the web's speaks of a browser.
- **Empty state**: with no people, the screen offers **Restore a backup**. That opens the system
  file picker, asks for the passphrase when the file is encrypted, merges the file, and reports
  what was restored.

Strings are the web keys. A string the web does not have yet is added to `frontend/src/i18n/en/`
and all nineteen locales, never hard-coded in native code.
