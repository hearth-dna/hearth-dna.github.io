# ADR 0001: Local-first — no personal data on any server we operate

**Date:** 2026-09-13 · **Status:** Accepted

## Context

codegen.eu (reviewed in `family_dna/docs/dna_projects.md`) processes uploads in memory for
seconds and still has to be a GDPR Article 9 data controller: consent capture, DPO, breach
procedure, DPA with AWS, a Merchant of Record, US state-law sections, a warrant canary.

## Decision

Genotypes, documents, notes, consents and chat history live only in the browser (SQLite WASM on
OPFS). The operator serves static files and, optionally, a stateless helper. A family using the
app for its own household falls under the GDPR household exemption; the operator is a tool
provider. Every off-device transfer is the user's own act, previewed and confirmed each time.

Enforced by: a single egress module with a test that no other file calls `fetch`; a CSP that
lists only our origin and the opt-in API host; a backend with no table for personal data.

## Consequences

- No accounts, no sync in v1; the dump file is the only backup and the app says so.
- The helper backend's LLM proxy and OCR endpoints do transiently process Article 9 data; they
  stay opt-in behind their own consent (design §13.1) and are not a dependency.
- Legal documents still needed before public release: privacy notice, terms, third-party
  notices — drafts in `landing/`.
