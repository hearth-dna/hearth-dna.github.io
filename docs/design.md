# Design proposal: local-first family genome PWA

**Status:** draft v0.3, 2026-09-13 (v0.3: local processing by default, copy-out context packs, consent UX)
**Working title:** *Hearth* (placeholder — rename freely)
**Inspired by:** codegen.eu review in dna_projects.md in the family_dna repo; this repo's SQLite DB, 30+ analysis files, questionnaires and pedigree.

---

## 1. Goal

A browser app (installable PWA, no native mobile app in v1) that does what codegen.eu does and more,
while **never letting genetic or medical data touch a server we operate**:

- Stores a **whole family** (many genomes + pedigree), not one genome per session.
- Answers **questions** about health conditions, diseases and drugs against the family's genotypes.
- Ingests **medical documents** (lab results, doctor letters, prescriptions) and links them to genetics.
- Produces a **full local dump** (JSON / gzipped JSON, optionally encrypted) that restores the entire
  state on any other device. No account, no sync server in v1.
- Works fully offline after first load.

## 2. Why "local-only" is the legal design, not just a privacy nicety

codegen.eu still has to be a GDPR data controller for Article 9 genetic data because the raw file
crosses into their server, even for seconds. That forces consent flows, a DPO, breach procedures, a
DPA with AWS, a Merchant of Record, US state-law sections, and a warrant canary.

If the operator **never receives** genotypes or medical documents:

| Actor | Role under GDPR | Consequence |
|---|---|---|
| The family member using the app for their own household | Falls under the **household exemption** (Art. 2(2)(c)) | No controller obligations for them |
| The app operator (us) | Provides a **tool**, like a spreadsheet; processes no personal data | Not a controller or processor of genetic data |
| Third-party LLM provider, if the user opts in with their own key | Processor/controller for that call, under the **user's** contract with them | The user chooses; the app shows exactly what is sent |

Residual obligations that still apply to us, and are cheap to meet:

- **Not a medical device (EU MDR 2017/745).** Same posture as codegen: informational, no diagnosis,
  no treatment recommendations, prominent disclaimers, no per-drug dosing advice. Keep pharmacogenomics
  phrased as "CPIC guideline says…" with links, not "take X mg".
- **EU AI Act transparency.** Any LLM-generated text is labelled as such.
- **Source licences.** dbSNP, ClinVar, GWAS Catalog: public domain / open. PharmGKB / CPIC: CC BY-SA 4.0.
  SNPedia: CC BY-NC-SA 3.0 — fine for a personal non-commercial tool, must be attributed, cannot be
  used if the project is ever monetised.
- **No telemetry.** Same as codegen: no analytics, no remote fonts, strict CSP, all assets self-hosted.

**Hard rule for the codebase:** the app works completely with no backend. Any backend call is an
explicit, per-feature opt-in, goes to a separate origin, is stateless, and never persists genetic or
medical data. CSP `connect-src` lists only `'self'`, the backend origin, and the LLM endpoint the user
configured. See §11 for the GCP backend that fits inside the Always Free tier.

## 3. Architecture

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│  UI (TypeScript, Svelte or React, Vite + vite-plugin-pwa)             │
│    ├─ Family / Pedigree     ├─ Person report      ├─ Ask (Q&A)       │
│    ├─ Topic browser         ├─ Documents          ├─ Export/Import   │
│                                                                       │
│  Workers                                                              │
│    ├─ import.worker   parse raw files (Ancestry/MyHeritage/23andMe/   │
│    │                  Genotek VCF/FTDNA/LivingDNA), stream → SQLite   │
│    ├─ analysis.worker Mendelian check, trio phasing, IBD segments,    │
│    │                  PRS, virtual kids, haplogroup calling           │
│    ├─ docs.worker     pdf.js text layer + Tesseract.js OCR           │
│    └─ llm.worker      optional WebLLM (WebGPU) local model            │
│                                                                       │
│  Storage: SQLite WASM (official sqlite.org build) on OPFS            │
│    ├─ user.db   persons, genotypes, documents, observations, notes    │
│    └─ kb.db     read-only knowledge base, versioned, replaceable      │
│                                                                       │
│  Crypto: WebCrypto AES-GCM + PBKDF2/Argon2 for dumps & at-rest lock   │
└───────────────────────────────────────────────────────────────────────┘
          │ static assets + kb.db (versioned, ~10–50 MB, cached by SW)
          ▼
   Cloudflare (free plan): Pages serves the app shell on app.<domain>,
   R2 serves kb.db, a Worker fronts api.<domain> → Cloud Run (see §11, §12)
          │ optional, opt-in per feature, stateless (see §11)
          ▼
   Cloud Run "helper" service (Go), europe-west1: LLM proxy, OCR/extraction,
   encrypted-blob sync. Nothing personal is written to disk or logs.
          │
          ▼
   LLM provider (operator key via proxy, or user's own key direct from
   the browser), or local WebLLM model, or none.
```

**Why SQLite WASM and not IndexedDB/Dexie:** this repo already has the schema, `family_all`,
`QUERIES.md` and `VIEWS.md`. Reusing SQL means every existing query and analysis ports directly, and
the dump can even be shipped as the same `.sqlite` if wanted. sqlite.org's WASM build with the OPFS
VFS handles 5M+ rows comfortably (current DB is 167 MB uncompressed with 7 people).

## 4. Data model (user.db)

```sql
person        (id, label, display_name, sex, birth_year, notes, created_at)
relationship  (parent_id, child_id)                       -- pedigree
source_file   (id, person_id, provider, build, sha256, imported_at, row_count, original_name)
snp_index     (rsid PRIMARY KEY, chromosome, position, ref, alt)   -- shared across persons
genotype      (person_id, rsid, allele1, allele2, source_file_id)  -- PK (person_id, rsid)
consistency   (person_id, rsid, flag)                     -- Mendelian violations, no-calls, strand fixes
document      (id, person_id, kind, title, date, mime, sha256, blob_ref, ocr_text, llm_summary)
observation   (id, person_id, document_id, code_system, code, display, value, unit, ref_low, ref_high, date)
              -- FHIR-lite: LOINC lab values, ICD-10 diagnoses, ATC medications, free-text
questionnaire (id, person_id, schema_version, answers_json, updated_at)   -- port of questionnaire/*.md
finding       (id, person_id, kb_entry_id, genotype, score, computed_at)  -- cached matches
note          (id, person_id, rsid_or_topic, markdown, updated_at)        -- user annotations
chat          (id, person_ids, question, context_sent_json, answer, model, created_at)
meta          (key, value)   -- schema_version, kb_version, created_by_app_version
```

Storage estimate: genotypes as text rows ≈ 25 MB/person in SQLite; fine for OPFS. A compact
alternative for dumps: per-person `Uint8Array` of 1-byte genotype codes over the shared `snp_index`
order (≈ 700 KB/person before gzip). Use text rows in the DB for queryability, compact arrays in the
export.

## 5. Knowledge base (kb.db) — the "pre-computed catalogue"

codegen's core asset is an offline-built catalogue; ours is the same idea, built by a script in this
repo and shipped as a versioned read-only SQLite file.

```sql
kb_variant   (rsid, gene, chromosome, position, ref, risk_allele, orientation, maf_eur, maf_global)
kb_entry     (id, rsid_or_group, genotype_pattern, topic_id, summary_md, evidence_grade, magnitude,
              direction, sources_json, generated_by, reviewed)
kb_topic     (id, name, category, description_md, prs_available)
kb_prs       (topic_id, rsid, effect_allele, beta, source_study)          -- GWAS Catalog / PGS Catalog
kb_pgx       (gene, star_allele, defining_rsids_json, function, cpic_guideline_url, drugs_json)
kb_group     (id, name, rsids_json, rule_json)                            -- haplotypes, star alleles
```

**Seed content, in priority order:**

1. This repo's 30+ analysis files: ~250 SNPs already annotated with evidence grades and the allele
   orientation corrections from CLINICAL_PRIORITY.MD. These become `reviewed = 1` entries.
2. CPIC/PharmGKB star-allele definitions for CYP2D6, CYP2C19, CYP2C9, VKORC1, SLCO1B1, DPYD, TPMT,
   NAT2, UGT1A1 (covers PHARMACOGENOMICS.MD and MEDICATION.md).
3. ClinVar pathogenic/likely-pathogenic variants present on consumer chips.
4. GWAS Catalog / PGS Catalog weights for ~50 common traits (T2D, CAD, LDL, BMI, AMD, etc.).
5. SNPedia magnitude ≥ 2 entries, attributed, non-commercial only.
6. Optional LLM-generated plain-language summaries per entry, generated **offline by the build
   script**, labelled `generated_by = 'llm:<model>'`, never from user genotypes.

The build script (`kb/build_kb.py`) runs on the maintainer's machine; the output is a plain file.
Users can drop in a newer `kb.db` without touching their data.

## 6. Features

### 6.1 Family, not one genome
- Import any number of raw files; auto-detect provider and build; dedupe by SHA-256.
- Pedigree editor. Mendelian consistency check per parent–child pair (already done manually in
  COVERAGE.md: 0.00% for bva+bgp→vova, <0.03% for vova+polina→kids).
- **Trio phasing:** with both parents genotyped, resolve which allele each child inherited from whom.
  Codegen cannot do this. Enables "Katja's CYP2C19*17 came from BVA" style answers.
- Shared segments / IBD estimation between any two members (ports MATCH.md).
- Virtual offspring for any pair (ports VIRTUAL_KIDS.md), including for not-yet-born or hypothetical
  partners if a second file is provided.
- Haplogroup calling from Y and mtDNA positions on the chip (ports HAPLOGROUPS.MD).
- Cross-platform merge: a person with both Ancestry and Genotek files gets a union genotype with
  conflict flags.

### 6.2 Reports and topics
- Per-person dashboard: notable findings ranked by evidence grade × magnitude, PGx card, PRS
  percentiles, coverage stats per platform.
- Family topic view: one SNP or topic across all members in one table (the `family_all` query).
- Category browser mirroring the repo's analysis files (clinical, lifestyle, traits).
- Everything links out to dbSNP, ClinVar, PharmGKB, GWAS Catalog; SNPedia links only where the entry
  came from SNPedia.

### 6.3 Ask — questions about conditions, diseases, drugs

Principle: **everything the app itself does runs locally.** Sending data anywhere is never
automatic; the user does it, sees exactly what leaves, and confirms it every time.

| Tier | Where the answer comes from | Data leaves device? | Default |
|---|---|---|---|
| 0 Offline | Retrieval over kb.db + templated answers ("You carry X; evidence grade A; CPIC says…") | Never | **on** |
| 1 Local LLM | WebLLM / WebGPU small model (3–8B) over the same retrieved context | Never | opt-in, if hardware allows |
| 2 **Copy-out context pack** | The app assembles a context block + a ready prompt; the user copies it into ChatGPT, Claude, Gemini, or any chat app they already trust | Yes — by the user's own hand, after preview | opt-in, per use |
| 3 BYOK cloud LLM | Direct browser→provider call with the user's API key | Yes, only the previewed context | opt-in, later phase |

Tier 2 is the pragmatic middle: no API key, no backend, no cost to us, and the legal act of
disclosure is the user's own (household use, their contract with the chat provider). It is expected
to be the most-used tier.

**Pipeline** for a question like *"Should Vova worry about clopidogrel?"*:
1. Resolve entities locally: person(s), drug → gene set (CYP2C19), condition → topic.
2. Retrieve locally: relevant `kb_entry` rows, the person's genotypes **for those rsids only**,
   matching observations (e.g. current medications from documents), questionnaire answers if relevant.
3. Build the **context pack** (see below) and show it in full. Names are replaced by labels
   (`Person A`, 42, male) by default; a toggle restores them. A counter shows how many genotypes,
   lab values and free-text fields are included, with per-item remove buttons.
4. Tier 0/1 answer inline. Tier 2: "Copy context" and "Copy context + prompt" buttons, plus
   "Open in…" links for ChatGPT / Claude / Gemini that only open the site, never pass data via URL.
   Tier 3: send after an explicit confirmation dialog.
5. The user can paste the assistant's reply back into a note attached to the question; the app
   stores Q, context and A locally in `chat`.

**Context pack format** (plain text / Markdown, deterministic, ~1–4 KB):

```
# Context for a health question (generated locally by <app>, not medical advice)
## Person A — male, 42
## Question
Should Person A worry about clopidogrel?
## Relevant genotypes (forward strand)
- CYP2C19 rs4244285 (*2): G/G — normal function allele ×2
- CYP2C19 rs12248560 (*17): C/T — one increased-function allele → likely rapid metaboliser
## Relevant observations (from uploaded documents, dated)
- 2026-05-12 Medication list: aspirin 100 mg, atorvastatin 20 mg
## Evidence notes (from the app's knowledge base, with sources)
- CPIC 2022 clopidogrel guideline: *1/*17 → standard dose. https://…
## Instructions for the assistant
Explain in plain language, list uncertainties, suggest questions to ask a clinician. Do not diagnose.
```

**Prompt library** (`ask/prompts/*.md`, editable by the user): "explain this finding",
"prepare questions for my doctor", "compare two family members on this topic", "is this
medication affected by my genetics", "summarise my lab trend", "second opinion on this report".
Each template declares which context sections it needs, so the pack is minimal by construction.

**Decision helpers**: for a finding, the app renders a short structured card — what is known,
evidence grade, what it would change, what it would not, what to ask a clinician — generated from
kb fields at tier 0, so the user gets a decision frame even without any LLM.

### 6.4 Medical documents — processed locally, never stored remotely
- **Shipped first (health log):** a per-person `health_log(id, person_id, date, kind, title, body,
  body_part, severity, tags, value, value2, unit)` of dated entries — lab result, diagnosis,
  medication, doctor letter, a self-reported **symptom** ("pain in both hands", body part `hands`,
  severity 6/10, tags `arthritis`), or a home **measurement** stored as numbers (`value`, a second
  `value2` for pairs like blood pressure, and `unit`: 37.8 °C, 120/80 mmHg, 71.5 kg) — typed or
  pasted from the paper. A preset list (`health/presets.ts`: common measurements, symptoms such as
  nosebleed or headache, events such as vaccination) prefills the form; custom entries stay free
  text. Body part and tags (conditions, diseases, free labels) apply to any kind and drive the
  log's filters (kind, body part, tag, text search).
  Gated by the `import_document` consent; part of the dump; offered entry-by-entry to the Ask
  context pack under "Health log". The steps below build on it.
- **Shipped second (BYOK document reader):** "Read a document" sends the photo/scan/PDF straight
  from the browser to Gemini with the user's own key (`egress.readDocumentWithGemini`, consent
  `read_document_byok`, confirmed per document, metadata-only row in the sharing log) and returns
  a transcription-only JSON draft the user reviews in the health-log form. The key lives in `meta`,
  is never dumped, and is deleted by "Erase all data" or by revoking the consent. Free-tier keys
  are flagged: Google may train on the input.
- Accept PDF, images, plain text. `pdf.js` extracts the text layer; `Tesseract.js` OCRs scans; both in
  a worker. Originals stored as blobs in OPFS, referenced from `document`.
- Structured extraction into `observation` rows (lab values with units and reference ranges,
  diagnoses, medications). Tier 0: regex/table heuristics for common lab layouts; tiers 1–2: LLM
  extraction with a fixed JSON schema.
- Cross-links: medication list × PGx → warnings (what MEDICATION.md does by hand); lab values ×
  topics (e.g. LDL over time next to the LDL PRS; TSH next to THYROID.MD findings).
- **If a backend for OCR is ever wanted** (weak devices), it must be stateless, in-memory, EU-hosted,
  log-free, and opt-in with a per-upload confirmation. That reintroduces controller status, so the
  default and recommended answer is: no backend, do it in the browser.

### 6.5 Export / import — the full dump
- Single file `hearth-dump-<date>.json.gz`. Format:

```json
{
  "format": "hearth-dump", "version": 1, "app_version": "0.1.0", "kb_version": "2026.09",
  "exported_at": "2026-09-13T10:00:00Z",
  "persons": [...], "relationships": [...], "source_files": [...],
  "snp_index": { "rsids": [...], "chromosome": [...], "position": [...] },
  "genotypes": { "<person_id>": "<base64 Uint8Array of genotype codes over snp_index order>" },
  "documents": [{ "...meta", "blob": "<base64>" }],
  "observations": [...], "questionnaires": [...], "notes": [...], "chats": [...]
}
```
- Compression with the browser's `CompressionStream('gzip')`; optional encryption with AES-GCM,
  key from passphrase via PBKDF2 (600k iterations) or Argon2id WASM. Encrypted dumps carry a
  `hearth-dump-enc` envelope with salt, nonce and KDF params.
- Also: per-person raw export back to 23andMe-style text (for uploading to other tools), and a
  plain `.sqlite` export for people who prefer SQL.
- Import restores everything, migrates old `version`s, and re-runs findings against the current kb.
- Expected size for this family: 7 genomes ≈ 5 MB gzipped plus documents.
- Backups to a USB stick or synced cloud folder, a single-file portable archive, and the dump v2
  container that carries them are designed in `architecture/storage/` (ADR 0004).

### 6.6 PWA specifics
- Service worker precaches the app shell and `kb.db`; runtime cache for nothing else.
- Installable on desktop and mobile browsers; responsive layout; File System Access API where
  available, fall back to `<input type=file>` and download links.
- Optional app lock: passphrase-derived key wraps a random data key; SQLite pages stay plain in OPFS
  in v1 (OPFS is origin-private), with an option to encrypt the DB file at rest in v2.
- Strict CSP; no third-party origins except the user-configured LLM endpoint.

## 7. Comparison with codegen.eu

| | codegen.eu | this proposal |
|---|---|---|
| Genomes | one per session | whole family, persistent |
| Raw data location | their RAM for seconds | user's browser only |
| Persistent identifier held by operator | HMAC hash of your genome, forever | none |
| Pedigree, trio phasing, IBD, virtual kids | no | yes |
| Medical documents | no | yes, local |
| Q&A | search only | local retrieval, copy-out context packs for any chat app, optional local/BYOK LLM |
| Knowledge base | LLM-built, SNPedia banned, closed | script-built, sources attributed, replaceable file |
| Export | print per page | full dump, gzipped/encrypted, re-importable |
| Legal role of operator | GDPR controller of Art. 9 data | tool provider, no personal data |
| Cost | €19 one-time | free / self-hosted |
| Content quality | 100k+ SNPs, 4,000+ topics | starts small (~250 reviewed SNPs), grows with the kb script |

## 8. Roadmap

| Phase | Scope | Exit criterion |
|---|---|---|
| 0 Spike (1–2 weeks) | Vite PWA + SQLite WASM/OPFS; import one AncestryDNA file in a worker; `family_all` query in UI | vova.txt imports in < 30 s, queries in < 100 ms offline |
| 1 Family core | All 3 formats + Genotek VCF, pedigree, Mendelian check, trio phasing, kb v1 from repo analyses, per-person report, dump export/import | The 7 current members reproduce CLINICAL_PRIORITY.MD findings |
| 2 Ask | Tier 0 retrieval answers; tier 2 copy-out context packs + prompt library; decision cards; chat notes | Answers the questions in `questionnaire/*.md` with citations; a context pack pasted into ChatGPT yields a usable answer |
| 3 Documents | pdf.js + Tesseract.js, observation extraction, PGx × medication alerts | A lab PDF becomes rows and shows next to relevant findings |
| 4 Depth | PRS from PGS Catalog, IBD, virtual kids, haplogroups, tier 1 WebLLM, tier 3 BYOK, encrypted dumps, at-rest encryption | Feature parity with the repo's analysis set |
| 5 Later | Optional end-to-end-encrypted blob sync (operator sees ciphertext only), native wrappers if ever needed | — |

## 9. Open decisions

1. **Framework:** ~~Svelte vs React~~ → **decided: React + TypeScript + Vite**, to mirror `../sentio`'s
   frontend and reuse its Biome/Vitest/i18n tooling (§12).
2. **Hosting:** ~~GitHub Pages vs separate repo~~ → **decided: separate repo `hearth`** on Cloudflare
   Pages, this repo stays the private data + kb source (§12).
3. **SNPedia inclusion:** include with attribution while strictly non-commercial, or exclude like codegen. Recommendation: include, flag entries by source, make it switchable in the kb build.
4. **Language:** UI in English first; content is already mixed Russian/English in this repo. Recommendation: i18n scaffold from day one, English + Russian.
5. **Genotek VCF:** convert on import (GT-resolved alleles, as done in the 2026-03-15 fix) and keep REF/ALT in `snp_index`.

## 10. Risks (see also §11.6 for backend-specific risks)

- **Browser storage eviction.** OPFS can be cleared by the browser under storage pressure. Mitigate:
  request `navigator.storage.persist()`, nag to export a dump after every import.
- **WebGPU availability** for tier 1; keep tier 0 fully useful.
- **Knowledge base quality** is the whole product. Reviewed entries from this repo first; LLM
  summaries always labelled and grade-capped at C unless reviewed.
- **Medical-device boundary.** Keep language informational; a lawyer's read before any public release.

## 11. GCP backend under the Always Free tier

Decision: the app stays local-first, and **the backend is optional infrastructure, not a
dependency**. With the copy-out tier in §6.3 the app delivers its full value with zero server-side
processing of personal data; the helper endpoints below are conveniences for later phases. A backend
is allowed on Google Cloud as long as it (a) stays inside the **Always Free** allowances (not the
90-day $300 trial), (b) never persists genetic or medical data in plaintext, and (c) every feature
that uses it is opt-in with its own consent (§13).

### 11.1 What the backend is for

| Job | Why a backend helps | GCP service | Data it sees |
|---|---|---|---|
| Serve app shell | PWA needs HTTPS origin | Cloudflare Pages (`app.<domain>`) | nothing personal |
| Distribute `kb.db` | 10–50 MB versioned file, public content | Cloudflare R2 (public bucket, free egress) | nothing personal |
| Rebuild `kb.db` monthly | ClinVar/GWAS/PGS/CPIC refresh without a laptop | Cloud Run Job + Cloud Scheduler | public datasets only |
| LLM proxy | one operator key, rate limits, no key in the browser | Cloud Run + Secret Manager | the minimal Q&A context (a few genotypes + kb text) in transit |
| OCR / document extraction | weak devices, better accuracy than Tesseract.js | Cloud Run + Cloud Vision API | the document, in memory, for one request |
| Encrypted sync (phase 5) | move a family between devices without carrying a file | Cloud Run + SQLite/Litestream (same shape as sentio's backend) | ciphertext blobs + an anonymous device id; key never leaves the browser |

Not in scope: no user database, no accounts with email, no analytics, no server-side report generation.

### 11.2 Free-tier budget (Always Free, per month, as published by Google — re-check before launch)

| Service | Free allowance | Our expected use | Notes |
|---|---|---|---|
| Cloud Run | 2 M requests, 180 k vCPU-s, 360 k GiB-s | < 5 k requests, < 5 k vCPU-s | `min-instances=0`, `max-instances=1`, 512 MiB, concurrency 8 |
| Cloud Run egress | 1 GB from North America | few MB (JSON responses) | responses are small; the kb file is *not* served from Cloud Run |
| Cloud Storage | 5 GB-months (US regions only) | Litestream replica of the sync DB, a few MB | same bucket pattern as sentio; `prevent_destroy` |
| Cloudflare Pages | unlimited bandwidth, 500 builds/month | app shell ≈ 2 MB, landing | direct-upload projects, same as sentio |
| Cloudflare R2 | 10 GB stored, 10 M class B reads/month, **zero egress fees** | one 50 MB kb file per version | replaces the GCS bucket idea; no US-only restriction |
| Cloudflare Workers | 100 k requests/day | Host-header rewrite for `api.<domain>` | same Worker as sentio's `cloudflare-worker-api.js` |
| Cloudflare rate limiting | 1 rule on the free plan | spent on `api.<domain>` | protects the Cloud Run free quota |
| Secret Manager | 6 active secret versions, 10 k access ops | 1–2 secrets | LLM provider key; cache in process memory to stay under access ops |
| Cloud Vision API | 1 000 units per feature | ≤ 1 000 pages OCR | hard-cap at the quota; beyond that the app falls back to Tesseract.js |
| Cloud Scheduler | 3 jobs | 2 (monthly kb rebuild, keep-warm ping if sync is enabled) | |
| Cloud Build | 120 build-min/day | a few builds a week | or build images in GitHub Actions and push to Artifact Registry |
| Artifact Registry | 0.5 GB | one ~150 MB image, keep 2 tags | prune old images |
| Cloud Logging | 50 GiB | ≈ 0 | request logging disabled for the helper service |
| Budget alert | — | threshold **€1**, email + disable-billing Cloud Function | the real safety net |

The only cost that is structurally *not* free is **LLM tokens**. Options, in order of preference:
1. User's own key (BYOK) passed through the proxy in a header and never stored, or called directly
   from the browser without the proxy at all.
2. Operator key with a per-device monthly cap enforced in the proxy.
3. Gemini API "free tier" via AI Studio: **rejected for health prompts** because free-tier prompts may
   be used to improve Google products under that tier's terms. Only the paid Gemini/Vertex tier gives
   the no-training, GDPR-processor terms. Acceptable only for prompts with zero genotypes (e.g. kb
   summarisation during the offline build).

### 11.3 Helper service design (Cloud Run, `europe-west1`)

```
POST /v1/ask        { context: {...minimal...}, question, model?, byok?: "sk-..." }  → { answer, citations }
POST /v1/ocr        multipart PDF/image (≤ 20 MB)                                     → { pages: [{text, blocks}] }
POST /v1/extract    { text, schema: "labs|meds|diagnoses" }                            → { observations: [...] }
PUT  /v1/sync/{id}  ciphertext blob (≤ 8 MB), bearer = device key signature            → 204
GET  /v1/sync/{id}                                                                     → ciphertext
GET  /healthz
```

Rules baked into the service:
- Stateless: no disk writes, `/tmp` disabled, request bodies processed in memory and dropped.
- No request/response body logging; access logs off; only status codes and latency to Cloud Logging.
- Secrets loaded once at startup from Secret Manager into memory.
- Vision API and LLM providers called under Google Cloud / provider DPA terms; BYOK keys never logged.
- CORS locked to `https://app.<domain>`, plus a shared-secret header set by the Cloudflare Worker (§12.4); `max-instances=1` and a per-IP token bucket to protect
  the free quota from abuse.
- Deploy with `--cpu-throttling`, `--min-instances=0`, `--concurrency=8`, `--memory=512Mi`.
- A privacy notice and a per-feature consent checkbox in the app before the first backend call
  (the LLM proxy and OCR endpoints do transiently process Article 9 data, which makes the operator a
  controller for that moment — same posture as codegen.eu, but with nothing persisted and no
  identifier kept).

### 11.4 Sync design (phase 5)

- Client generates a random 256-bit data key, wraps it with a passphrase (Argon2id) and keeps it in
  IndexedDB; the passphrase is the only thing the user carries between devices.
- Dump is gzipped and encrypted with AES-GCM in the browser, then PUT as one blob to the Go backend,
  which stores it in SQLite (`blobs(device_id, version, ciphertext, sha256, created_at)`) replicated
  to GCS by Litestream — the exact persistence model sentio uses, so `entrypoint.sh`,
  `litestream.yml`, the Dockerfile and the Terraform module port unchanged.
- No accounts. The browser generates an Ed25519 device keypair; the public key hash is the device id
  and each request is signed. Pairing a second device = scanning a QR with the passphrase-wrapped
  data key, same as the export path.
- Operator holds ciphertext and a random device id only. "Erase" deletes the rows; a Cloud Scheduler
  job expires blobs older than 90 days without a refresh.
- Sizing: ~5 MB per family per version, keep the last 3 → well under the ~150 MB SQLite ceiling
  sentio's ADR 0047 sets for this backend shape.

### 11.5 Region and data-residency note

- Personal-data-touching pieces (Cloud Run helper, its Litestream replica) go to **europe-west1 (Belgium)**.
- Public content (kb.db) goes to **Cloudflare R2**, which has no region restriction on the free
  tier and no egress fees; the Litestream replica bucket stays in a US region (free tier is US-only)
  and only ever holds ciphertext.
- Verify on the pricing pages at setup time that the Cloud Run free allowance is not region-restricted
  for the chosen region; if it turns out to be, fall back to a US region for the helper service and
  document that in the privacy notice.

### 11.6 Backend-specific risks

- **Quota exhaustion → bills.** Mitigate with `max-instances=1`, the €1 budget alert wired to a
  billing-disable function, and client-side fallbacks (Tesseract.js, tier 0 answers) when the backend
  returns 429.
- **Reintroducing controller status.** Only the LLM proxy and OCR endpoints do, and only transiently.
  Keep them opt-in, documented, log-free.
- **Free-tier terms change.** Google has revised Always Free before. Everything the backend does has a
  browser-only fallback, so the app degrades rather than breaks.

## 12. Repository layout and infrastructure — mirroring `../sentio`

The app gets its own repository (open decision 2 → **decided: separate repo, working name
`hearth`**), laid out exactly like `../sentio` so the tooling, runbooks and CI carry over. This
repo (`family_dna`) stays the private data set and the source of the knowledge-base build.

### 12.1 Tree

```
hearth/
├── README.md  CLAUDE.md  AGENTS.md  IDEA.md     # the only root files (sentio rule: root stays clean)
├── Makefile                                     # the command surface; `make help` is the source of truth
├── .env.example                                 # local backend config; .env is gitignored
├── frontend/                                    # the PWA — React + TypeScript + Vite, Biome, Vitest
│   ├── AGENTS.md
│   ├── package.json  vite.config.ts  biome.jsonc  tsconfig.json
│   ├── public/            manifest.webmanifest, icons, _redirects, _headers (CSP)
│   └── src/
│       ├── main.tsx  App.tsx  routes.ts
│       ├── db/            sqlite-wasm + OPFS bootstrap, migrations, typed queries
│       ├── import/        provider parsers (ancestry, myheritage, 23andme, ftdna, livingdna, genotek-vcf)
│       ├── family/        pedigree, mendelian, phasing, ibd, virtual-kids, haplogroups
│       ├── kb/            kb.db loader, versioning, finding computation
│       ├── report/        person dashboard, topic pages, family table
│       ├── ask/           retrieval, prompt builder, context preview, tier 0/1/2 clients
│       ├── documents/     pdf.js + tesseract workers, observation extraction
│       ├── export/        dump v1 writer/reader, gzip, AES-GCM
│       ├── sync/          device keypair, signed requests, blob push/pull (phase 5)
│       ├── workers/       import.worker.ts analysis.worker.ts docs.worker.ts llm.worker.ts
│       ├── i18n/          en + ru message catalogs (sentio's message-id convention, ADR 0049)
│       └── components/  styles.css  types.ts
├── backend/                                     # Go helper service — chi, modernc.org/sqlite, Litestream
│   ├── AGENTS.md  Dockerfile  entrypoint.sh  litestream.yml  go.mod
│   ├── cmd/server/main.go  ask_handlers.go  ocr_handlers.go  extract_handlers.go  sync_handlers.go
│   ├── internal/
│   │   ├── config/        env → Config, fails closed on missing secrets
│   │   ├── middleware/    maxbytes, device-signature auth, no-body-logging
│   │   ├── llm/           provider clients (Anthropic, OpenAI-compatible), BYOK passthrough, per-device caps
│   │   ├── ocr/           Cloud Vision client with the 1 000-unit hard cap
│   │   └── store/         blobs only — the single table the sync feature needs
│   └── migrations/0001_blobs.sql
├── kb/                                          # knowledge-base build (Python), output = kb.db → R2
│   ├── build_kb.py  sources/  reviewed/         # reviewed/ = curated entries exported from family_dna
│   └── README.md
├── landing/                                     # static marketing page, privacy, terms — apex Pages project
├── terraform/                                   # GCP + Cloudflare, ported from sentio/terraform
│   ├── AGENTS.md  README.md  main.tf  variables.tf  outputs.tf  secrets.tf  monitoring.tf
│   ├── cloudflare.tf  cloudflare-pages.tf  cloudflare-r2.tf  cloudflare-worker-api.js
│   ├── modules/cloud-run/
│   └── environments/production.tfvars.example
├── scripts/                                     # bootstrap.sh, ci-secrets.sh, lib.sh, smoke-local.py, kb-publish.sh
├── docs/
│   ├── architecture/overview.md  data-formats.md (dump v1, kb.db schema)
│   ├── decisions/0001-…                         # ADRs, sentio style
│   ├── runbook/first-deploy.md  kb-release.md
│   └── testing/
└── .github/workflows/  ci.yml (tests + change-aware deploys, one runner)  publish-kb.yml
```

### 12.2 What is copied verbatim from sentio, what changes

| Piece | From sentio | Change for hearth |
|---|---|---|
| `backend/Dockerfile`, `entrypoint.sh`, `litestream.yml` | as-is | none |
| `backend/internal/store` | SQLite + migrations | one `blobs` table; **no genotype or document ever hits the store** |
| Auth | Google / Apple sign-in, refresh tokens | removed; Ed25519 device signatures, no identities table |
| GraphQL (`gqlgen`) | yes | dropped; four JSON endpoints are simpler and keep the "no body logging" rule auditable |
| `terraform/main.tf`, `modules/cloud-run`, `secrets.tf`, `monitoring.tf` | as-is | region `europe-west1`; secrets = `llm-api-key`, `cloudflare-api-token`; budget alert €1 |
| `terraform/cloudflare.tf` + Worker | as-is | add `cloudflare-r2.tf` for the kb bucket and a custom domain `kb.<domain>` |
| `terraform/cloudflare-pages.tf` | frontend + landing projects | same two projects, names `hearth-frontend`, `hearth-landing` |
| `terraform/email.tf` | Mailgun + Email Routing | keep, gated, for `contact@<domain>` (privacy contact) |
| `.github/workflows/*` | WIF auth, path filters, tests gate | one `ci.yml` job (free-tier minutes: tests once, deploy steps gated by `git diff`, no Dependabot version PRs); add `publish-kb.yml`: builds `kb.db` on a tag and uploads to R2 with wrangler |
| `Makefile` | android/ios/backend/frontend/landing/setup/i18n | drop mobile targets; add `kb-build`, `kb-publish`, `dump-roundtrip` (test) |
| `scripts/bootstrap.sh` | 14 idempotent steps | drop OAuth steps; add R2 bucket + token step |
| `frontend/` stack | React 19, Vite, Biome, Vitest, `fflate` | same, plus `@sqlite.org/sqlite-wasm`, `vite-plugin-pwa`, `pdfjs-dist`, `tesseract.js` |
| `frontend/public/_redirects` | SPA fallback | same, plus `_headers` with the strict CSP |
| `docs/decisions` | ADR format | start with the six ADRs listed below |
| i18n | 21 locales, Gemini-translated | en + ru only at first; same message-id checker |

### 12.3 Makefile surface (subset of sentio's, same naming)

```
help
frontend-install  frontend-run  frontend-build  frontend-test  frontend-deploy
backend-build     backend-test  backend-run     backend-image  backend-deploy   smoke
landing-deploy    landing-check
kb-build          kb-test       kb-publish                      # build_kb.py → kb.db → R2
dump-roundtrip                                                  # export → import → diff, in Vitest
dev  dev-stop  dev-status                                       # backend + Vite in the background
setup  setup-plan  setup-verify  setup-steps  ci-secrets  ci-secrets-check
i18n-check  i18n-gate
```

### 12.4 Edge and origin

```
                         ┌── app.<domain>  → Cloudflare Pages (frontend/dist, SPA fallback, CSP headers)
                         ├── <domain>      → Cloudflare Pages (landing/, privacy, terms)
Client ── Cloudflare ────┼── kb.<domain>   → R2 bucket (kb-<version>.db, immutable, cache 1y)
        (TLS/CDN/WAF/    └── api.<domain>  → Worker rewrites Host → Cloud Run hearth-backend
         1 rate-limit)                        (min 0 / max 1, 512Mi, europe-west1)
                                                  ├── Secret Manager: llm-api-key
                                                  └── GCS: <project>-sqlite-replica (Litestream, ciphertext only)
Cloud Scheduler ── /health every 5 min (only when sync is enabled — otherwise let it scale to zero)
```

Differences from sentio's ADR 0047 worth recording in hearth's own ADR:
- **The origin is reachable without personal data.** sentio accepts that `*.run.app` bypasses the
  rate limiter; hearth adds a shared-secret header set by the Worker and checked in Go middleware,
  because the free LLM/OCR quotas are the thing an abuser would drain.
- **Keep-warm is off by default.** There is no Litestream restore cost unless sync is enabled, and a
  cold start on an opt-in helper call is acceptable.
- **R2, not GCS, for public files**, because egress is free and the region restriction goes away.

### 12.5 ADRs to write first

1. `0001-local-first-no-personal-data-on-the-server.md` — the household-exemption argument (§2).
2. `0002-sqlite-wasm-on-opfs.md` — why not IndexedDB; the schema ports from `family_dna`.
3. `0003-cloudflare-edge-gcp-free-tier.md` — port of sentio ADR 0047 with §12.4's differences.
4. `0004-stateless-helper-endpoints.md` — LLM proxy, OCR, extraction; no body logging; per-device caps.
5. `0005-dump-format-v1.md` — JSON envelope, compact genotype arrays, gzip, AES-GCM, migration policy.
6. `0006-knowledge-base-build-and-licences.md` — sources, SNPedia non-commercial switch, LLM labelling.

### 12.6 Bootstrapping order

1. `git init hearth`; copy `Makefile`, `scripts/lib.sh`, `scripts/bootstrap.sh`, `terraform/`,
   `.github/workflows/`, `backend/{Dockerfile,entrypoint.sh,litestream.yml}` from sentio; strip
   mobile and OAuth pieces.
2. `frontend/`: Vite React template + Biome config from sentio; add sqlite-wasm and the PWA plugin;
   port `family_all` and the COVERAGE.md Mendelian query as the first two tests.
3. `kb/build_kb.py` v0: export the reviewed SNP tables from this repo's analysis files to `kb.db`.
4. `make setup` against a fresh GCP project, `enable_cloudflare = false`; apply the GCP half.
5. Register the domain, flip `enable_cloudflare`, apply; `make frontend-deploy`, `make kb-publish`.
6. Only then write the first backend handler (`/v1/ask` with BYOK passthrough).

## 13. Legal compliance and consent UX

The app is built so that the operator processes no personal data (§2). The obligations that remain
sit with the user's own choices, and the UI has to make those choices explicit, informed and
revocable. Everything below is a design requirement, not a nice-to-have.

### 13.1 Consent points (each its own checkbox, each logged locally with timestamp + text version)

| When | What the user confirms | Basis / why |
|---|---|---|
| First launch | Read the plain-language notice: local storage only, not a medical device, LLM content may be wrong, 18+ | AI Act transparency; MDR boundary; codegen-style honesty |
| Importing a genome | "This is my DNA, or I have the explicit consent of the person it belongs to; for a minor I am the parent/guardian" | GDPR Art. 9 applies to the *user* only outside the household exemption, but consent of relatives is an ethical and contractual must (same rule codegen enforces) |
| Adding a person under 18 | Separate guardian confirmation + note that the child can ask for deletion later | Children's data |
| Importing a medical document | "I am entitled to hold this document" | health data |
| Enabling tier 1 (local model) | Download size, runs on device, still may be wrong | informational |
| Using tier 2 (copy-out) — **every time**, not once | Preview shown; "I understand this text will be pasted into a third-party service under *their* terms; I have removed anything I do not want to share" | The disclosure is the user's act; make it deliberate |
| Enabling tier 3 (BYOK) | Provider name, what is sent, that their DPA/terms govern; key stored locally only | user is the contracting party |
| Enabling any helper endpoint (§11) | Feature-specific notice: what is sent, that it is processed in memory in the EU and not stored, retention = 0 | Here the operator *is* transiently a controller → explicit consent, Art. 9(2)(a), withdrawable by toggling off |
| Enabling encrypted sync | Ciphertext leaves the device; passphrase loss = data loss | informational |
| Export unencrypted dump | Warning that the file is plaintext genetic data | informational |

Consent records live in a local `consent(kind, version, subject, granted_at)` table, are part of
the dump, and every consent has a one-tap "revoke" in Settings. Revoking is deletion: the record is
removed and so is everything it covered — for a genome consent, that person's genotypes and source
files (the person, notes and pedigree stay); for the first-launch consent, the app returns to the
gate. No "revoked" rows are kept.

### 13.2 Data-handling rules enforced in code

- No network call carries genotypes, observations or document text unless a tier-3 or helper
  consent is active **and** the specific request was confirmed. Enforced by a single `egress.ts`
  gateway that every fetch goes through; the CSP and a Vitest test assert nothing else can reach
  the network.
- Copy-out packs are generated by pure functions with snapshot tests so the user can rely on "what I
  previewed is what I copied".
- Default pseudonymisation in packs (labels, ages rounded to 5 years, dates to month) with an
  explicit toggle to include real names.
- A "Sharing log" screen lists every pack copied and every request sent, with the exact payload, so
  the user can audit what has left the device.
- Delete = delete: erasing a person removes genotypes, documents, findings, chats and consent rows;
  the dump is the only backup and the app says so.

### 13.3 Documents to ship with the app

- Privacy notice (short, codegen-style plain words + the legal section): what the app stores
  (nothing server-side), what the optional features send and where, contact address.
- Terms: informational service, not a medical device, LLM error disclosure, 18+, relatives'
  consent, no diagnosis, no discrimination use.
- Third-party notices: dbSNP, ClinVar, GWAS/PGS Catalog, PharmGKB/CPIC (CC BY-SA), SNPedia
  (CC BY-NC-SA; non-commercial only), pdf.js, Tesseract, sqlite-wasm.
- If helper endpoints are enabled in production: a data-protection contact and a 72-hour breach
  procedure, as in codegen's policy, scaled to the fact that nothing is stored.

### 13.4 Copy-out and third-party assistants — what the app must tell the user

- Consumer ChatGPT/Claude/Gemini accounts may use conversations for training unless the user has
  turned that off; the notice links to each provider's setting and recommends turning it off or
  using a paid/API tier.
- Health information pasted into a chat is covered by that provider's privacy policy, not ours.
- Recommend not including names, birth dates or document scans; the pack defaults do this.
- The assistant's answer is not medical advice; the decision card's "questions for a clinician"
  list is the intended output of the whole flow.
