package com.hearth.data

/**
 * The web app's schema, copied verbatim from frontend/src/db/schema.ts (ADR 0010): the same
 * tables on every platform are what let a backup restore anywhere. SchemaTest fails when the two
 * drift; copy the new text across rather than editing it here.
 */
const val SCHEMA_VERSION = 1

const val SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS person (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, display_name TEXT NOT NULL, sex TEXT NOT NULL,
  birth_year INTEGER, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relationship (
  parent_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, child_id)
);
CREATE TABLE IF NOT EXISTS source_file (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, build TEXT NOT NULL, sha256 TEXT NOT NULL, original_name TEXT NOT NULL,
  row_count INTEGER NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS genotype (
  person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  rsid TEXT NOT NULL, chromosome TEXT NOT NULL, position INTEGER NOT NULL,
  a1 TEXT NOT NULL, a2 TEXT NOT NULL,
  PRIMARY KEY (person_id, rsid)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS genotype_rsid ON genotype(rsid);
CREATE TABLE IF NOT EXISTS consent (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, version INTEGER NOT NULL, subject TEXT NOT NULL DEFAULT '',
  granted_at TEXT NOT NULL, revoked_at TEXT -- legacy, always NULL: revoking deletes the row
);
CREATE TABLE IF NOT EXISTS health_log (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '', body_part TEXT NOT NULL DEFAULT '', severity INTEGER,
  tags TEXT NOT NULL DEFAULT '', value REAL, value2 REAL, unit TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
/* Added after schema version 1; created idempotently like every other table. The bytes live in
   the OPFS file cache as att-<sha256>.bin, never in a BLOB column (ADR 0001). */
CREATE TABLE IF NOT EXISTS attachment (
  id TEXT PRIMARY KEY,
  health_log_id TEXT NOT NULL REFERENCES health_log(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL, -- of the plaintext bytes: identity, dedup key and integrity check
  mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  name TEXT NOT NULL, -- display only; never used to build a file name
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachment_entry ON attachment(health_log_id);
CREATE INDEX IF NOT EXISTS attachment_sha ON attachment(sha256);
CREATE TABLE IF NOT EXISTS note (
  id TEXT PRIMARY KEY, person_id TEXT, topic TEXT NOT NULL, markdown TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat (
  id TEXT PRIMARY KEY, person_ids TEXT NOT NULL, question TEXT NOT NULL, context_pack TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sharing_log (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, destination TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
"""

/**
 * [SCHEMA_SQL] as single statements, for APIs that run one at a time: comments stripped first,
 * because one of them contains a semicolon.
 */
fun schemaStatements(sql: String = SCHEMA_SQL): List<String> =
    sql.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
        .replace(Regex("--[^\\n]*"), "")
        .split(';')
        .map { it.trim() }
        .filter { it.isNotEmpty() }

/** The meta rows a new database starts with (db.ts): schema version, a random device id, generation 0. */
fun seedMeta(): List<Pair<String, String>> =
    listOf("schema_version" to SCHEMA_VERSION.toString(), "device" to Repo.newId(), "generation" to "0")
