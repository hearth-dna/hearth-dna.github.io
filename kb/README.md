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
