# Open formats: CSV for spreadsheets, JSON Lines for scripts

The dump (`dump-v2.md`) is for Hearth to read back. These files are for the user: open in Excel,
Numbers or LibreOffice, or load in Python, R or a shell one-liner. No Hearth code is needed to use
them, and nothing in them is Hearth-specific beyond column names.

Settings → *Open formats*. One format selector (CSV or JSON Lines) and three buttons. The files are
plaintext by design and the card says so; anyone wanting an encrypted copy uses the dump.

## Files

All three carry every person. Names: `hearth-<what>-<date>.csv` / `.jsonl`.

| File | Row | Columns |
|---|---|---|
| `genotypes` | one SNP | `rsid`, `chromosome`, `position`, then one column per person named by the person's short label (`mama`, `papa`, …; a duplicate label gets `-2`, `-3`). Cell = two alleles (`AG`), empty when that person has no call. |
| `findings` | one knowledge-base match for one person | `person`, `rsid`, `gene`, `name`, `genotype`, `risk_allele`, `risk_copies`, `magnitude`, `label`, `evidence`, `topic`, `conditions`, `drugs`, `summary`, `sources` |
| `health-log` | one health-log entry | `person`, `date`, `kind`, `title`, `body_part`, `severity`, `value`, `value2`, `unit`, `tags`, `source`, `body`, `created_at` |

Lists inside a cell (`conditions`, `drugs`, `tags`) are `; `-separated in CSV and JSON arrays are
*not* used there so a spreadsheet shows them as text; in JSON Lines they are the same strings, so
the two formats stay column-for-column identical. `sources` is space-separated URLs.

CSV: RFC 4180 quoting, UTF-8 with a byte-order mark (Excel then reads accented text correctly),
`\n` line ends. JSON Lines: one object per line, `null` for an empty number.

## Why one table per person column, not one file per person

A family of seven is ~5 M genotype rows; as separate files that is seven downloads and no easy way
to compare. One wide table, sorted by chromosome then position, is a `VLOOKUP`/`merge` away from
any question ("where do the kids differ from both parents?").

Two sizes, a checkbox on the card (default on): **only SNPs every person has a call for**, the set
you can actually compare, or the union of all files. Measured on a family of seven across three
providers (2026-09-16): union 1,162,587 rows / 41 MB CSV in ~50 s, which is over the 1,048,576-row
limit of Excel and LibreOffice; shared set 151,925 rows. JSON Lines has no such limit.

The table is built inside the SQLite worker (`genotype-table` op) with one `MAX(CASE WHEN
person_id = … )` column per person, ordered numerically by chromosome, and streamed into a byte
buffer there, so the main thread never holds millions of row objects. Findings and the health log
are small and formatted on the main thread (`export/table.ts`, pure and tested).

## Where things are

| Piece | Code |
|---|---|
| Formatting (CSV quoting, JSON Lines, column layouts) | `frontend/src/export/table.ts` (+ test) |
| Genotype table in the worker | `frontend/src/db/db.worker.ts` `genotypeTable`, `db.ts` |
| Downloads | `frontend/src/export/openFormats.ts` |
| Card | `frontend/src/components/OpenFormatsCard.tsx` |
