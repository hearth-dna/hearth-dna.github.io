# kb/ — knowledge base source

`reviewed/*.json` are hand-curated SNP entries (one file per topic). `build_kb.py` validates them
and writes `frontend/public/kb.json`, which the PWA loads from its own origin and caches offline.

Entry shape: `rsid, gene, name, risk_allele, orientation, evidence (A/B/C), summary, genotypes
{"AG": {label, magnitude}}, sources[], drugs[]?, conditions[]?`. Genotype keys are forward-strand;
the build sorts the two alleles so `GA` and `AG` are the same key.

Allele orientation follows family_dna's CLINICAL_PRIORITY.MD (2026-09-09): CYP2C19*17 = T,
FOXE1 = A, MSMB = T, APOA5 = G, NAT2*5 = C.

Later sources (design §5): CPIC star-allele tables, ClinVar pathogenic on consumer chips, PGS
Catalog weights, SNPedia (non-commercial only, switchable).
