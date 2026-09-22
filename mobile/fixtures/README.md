# Golden backups

Dump v2 files written by the web app's own code (`frontend/src/export/fixtures.test.ts`), with
invented data. The Android and iOS restore tests open them and compare the result with
`journal.json`; the web test opens them too. That is how the three implementations stay able to
read each other's backups (ADR 0010).

- `plain.hearth` — unencrypted.
- `encrypted.hearth` — the same content in the AES-GCM envelope; passphrase
  `correct horse battery staple`.

Regenerate with `UPDATE_FIXTURES=1 npx vitest run src/export/fixtures.test.ts` in `frontend/`, and
commit the three files together.
