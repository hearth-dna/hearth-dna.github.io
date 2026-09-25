import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { complete, missingChild, missingChildEncrypted } from './family'

// Rewrites the committed fixtures; skipped unless asked: `make frontend-fixtures`.
describe.runIf(process.env.WRITE_FIXTURES)('write backup fixtures', () => {
  it('writes family*.hearth', async () => {
    writeFileSync(`${__dirname}/family.hearth`, await complete())
    writeFileSync(`${__dirname}/family-missing-genome.hearth`, await missingChild())
    writeFileSync(`${__dirname}/family-missing-genome.hearth.enc`, await missingChildEncrypted())
  })
})
