export const SCHEMA_VERSION = 1

/** user.db — everything the app stores. Lives in OPFS; never leaves the device except as a dump. */
export const SCHEMA_SQL = `
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
  date TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '', body_part TEXT NOT NULL DEFAULT '', severity INTEGER,
  tags TEXT NOT NULL DEFAULT '', value REAL, value2 REAL, unit TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
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
`
