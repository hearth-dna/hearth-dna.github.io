# kb/ — knowledge base source

`reviewed/*.json` are hand-curated SNP entries (one file per topic). `build_kb.py` validates them
and writes `frontend/public/kb.json`, which the PWA loads from its own origin and caches offline.

Entry shape: `rsid, gene, name, risk_allele, orientation, evidence (A/B/C), summary, genotypes
{"AG": {label, magnitude}}, sources[], drugs[]?, conditions[]?`. Genotype keys are forward-strand;
the build sorts the two alleles so `GA` and `AG` are the same key. `conditions` holds condition
ids from the catalogue below, never free text.

## Conditions

`reviewed/conditions.json` is the condition catalogue: the one id that ties a family's DNA markers
to the health-log records about the same condition. Shape: `id, names {en, ru, …}, synonyms {lang:
[…]}?, icd10[], category, rsids[], labs [{name, loinc?, synonyms?}], measurements[] (preset ids from
frontend/src/health/presets.ts), symptoms[], body_parts[] (BODY_PARTS in types.ts), drugs[],
summary?, sources[]?, reviewed_at`. `names.en` is required; the app falls back to it for other
languages. Names, synonyms, lab names and drugs are what the app matches free text against, in
any language listed, so add the words people actually write ("high blood pressure", "давление").

The build checks every id a marker names, and links both ways: a marker listing `t2d` joins
`t2d.rsids`, and a condition listing an rsid adds itself to that marker. A condition may name an
rsid nobody has curated yet (a note, not an error). `conditions.test.ts` checks that measurements
and body parts exist in the frontend.

Allele orientation follows family_dna's CLINICAL_PRIORITY.MD (2026-09-09): CYP2C19*17 = T,
FOXE1 = A, MSMB = T, APOA5 = G, NAT2*5 = C.

Later sources (design §5): CPIC star-allele tables, ClinVar pathogenic on consumer chips, PGS
Catalog weights, SNPedia (non-commercial only, switchable).

## Lab catalogue

`reviewed/labs/` is what the document reader maps printed blood-test results onto, from a glucose
slip to a full biochemistry panel (`frontend/src/labs/`):

- `analytes.json`: one id per test. `names` and `synonyms` per language, `abbreviations` as
  printed (HGB, NEUT%, АЛТ), `loinc[]`, `panels[]`, `specimen[]`, the canonical `unit`, and
  `units`: every other accepted unit with the factor that multiplies it into the canonical one
  (null when there is no exact conversion, as for Lp(a) mg/dL). HbA1c % ↔ mmol/mol is not linear
  and names a conversion (`convert: "hba1c"`) implemented in `labs/normalise.ts`. `plausible` is
  the range outside which a value is a transcription slip, not a result; it is not a reference
  range, which always comes from the printed report.
- `panels.json`: named groups (complete blood count, lipid panel, metabolic panel…) with the names
  labs print for them.
- `units.json`: each canonical unit and its printed spellings (`ммоль/л`, `×10⁹/л`, `тыс/мкл`,
  `Ед/л`…), compared after lower-casing and removing spaces.

A percentage and an absolute count of the same cells are separate ids (`neut_pct`, `neut_abs`);
the reader tells them apart by the printed unit. Conditions name their lab tests by these ids.
The build rejects unknown units, panels and conversions, non-positive factors and a unit
spelling claimed by two units. LOINC codes were entered by hand and should be checked against
loinc.org when an entry is next reviewed.

