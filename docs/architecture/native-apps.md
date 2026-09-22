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
| SQL seam | `data/Sql.kt`: the interface `Db` implements on the phone and a JDBC SQLite implements in JVM tests | — |
| Repository | `data/Repo.kt`: persons, health log, attachments (metadata), consents | `Data/Repo.swift` |
| Backup restore | `backup/Container.kt` (zip, AES-GCM envelope), `backup/Restore.kt` | `Backup/Container.swift`, `Backup/Restore.swift` |
| Pure logic | `health/HealthLog.kt`, `health/Presets.kt`: ports of `health/log.ts` and `health/presets.ts` | `Health/HealthLog.swift` |
| Strings | `i18n/Strings.kt`: reads the web JSON from assets | `I18n/Strings.swift`: reads the web JSON from the bundle |
| Screens | `ui/…` Compose + Material 3; entry point `NativeActivity` in `src/debug/` | `UI/…` SwiftUI |

Nothing in these layers talks to the network yet. When something does, it goes through one
`Egress` type per platform (ADR 0010).

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
- **Not in the first slice**: genomes (they need the import parsers) and attachment bytes (they
  come from the backup folder). Restore skips both and says so.
- **Fixtures**: `mobile/fixtures/` (see its README). Every restore test opens `plain.hearth` and
  `encrypted.hearth` and compares the database with `journal.json`.

## Health log screen (first slice)

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
