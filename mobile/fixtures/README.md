# Golden backups

Dump v2 files with invented data that all three apps must read the same way (ADR 0010). The
Android and iOS restore tests open them and compare the result; the web test opens them too.

Written by the web app's own code (`frontend/src/export/fixtures.test.ts`):

- `plain.hearth` — unencrypted.
- `encrypted.hearth` — the same content in the AES-GCM envelope; passphrase
  `correct horse battery staple`.
- `journal.json` — what both of the above contain.
- `genomes.hearth` — the same family with two small 23andMe-format genomes inside, for the
  genome restore, findings, Mendelian checks and family lookups.

Regenerate with `UPDATE_FIXTURES=1 npx vitest run src/export/fixtures.test.ts` in `frontend/`.

Written by the native apps from `genomes.hearth`, restored and exported again; the web test opens
each and expects the same family:

- `android.hearth` — `UPDATE_FIXTURES=1 ./gradlew :app:testDebugUnitTest --tests '*SnapshotTest'`
  in `mobile/android/`.
- `ios.hearth` — the iOS `SnapshotTests` with `UPDATE_FIXTURES=1` in the scheme's environment.
