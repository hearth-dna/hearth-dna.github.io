# Backup fixtures

Small dump v2 files for the restore and folder-repair tests (`backups.test.ts`). The data is
synthetic: two invented people (`Test Parent`, `Test Child`), five invented genotypes each on
well-known rsids, one health-log entry. No real genome belongs here (CLAUDE.md).

| File | What it is |
| --- | --- |
| `family.hearth` | A healthy plain backup: two genomes, the manifest lists both. |
| `family-missing-genome.hearth` | The broken shape seen in the field: the manifest lists the child's genome, the zip has no entry for it. The app's writer refuses to produce this, so it is made by deleting the entry afterwards. |
| `family-missing-genome.hearth.enc` | The same, in the AES-GCM envelope; passphrase `fixture passphrase`. |

The contents are defined in `family.ts`. After changing it, rewrite the files with
`make frontend-fixtures` and commit them.
