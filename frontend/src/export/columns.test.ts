import { describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from '../db/schema'
import { ATTACHMENT_COLS, HEALTH_COLS } from './restore'

/**
 * A dump is restored through an allowlist of column names, never the names in the file. That means
 * a column added to the schema and not to the allowlist is silently dropped on every restore — the
 * kind of loss nobody notices until they need the backup. These tests tie the two together.
 */
function columnsOf(table: string): string[] {
  const body = SCHEMA_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`))
  if (!body) throw new Error(`no ${table} in SCHEMA_SQL`)
  return body[1]
    .replace(/--[^\n]*/g, '')
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name)) // table constraints start with a keyword
}

describe('restore allowlists', () => {
  it('covers every health_log column', () => {
    expect(HEALTH_COLS).toEqual(columnsOf('health_log'))
  })

  it('covers every attachment column', () => {
    expect(ATTACHMENT_COLS).toEqual(columnsOf('attachment'))
  })
})
