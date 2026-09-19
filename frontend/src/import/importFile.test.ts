import { describe, expect, it } from 'vitest'
import { personFromFileName } from './importFile'

describe('personFromFileName', () => {
  it('derives a label and keeps the stem as display name', () => {
    expect(personFromFileName('AncestryDNA (1).txt')).toEqual({
      label: 'ancestrydna-1',
      displayName: 'AncestryDNA (1)',
    })
    expect(personFromFileName('alex_23andme.txt.zip')).toEqual({
      label: 'alex-23andme',
      displayName: 'alex_23andme',
    })
    expect(personFromFileName('genome_Maria.csv.gz')).toEqual({
      label: 'genome-maria',
      displayName: 'genome_Maria',
    })
  })
  it('never yields an empty label', () => {
    expect(personFromFileName('.txt').label).toBe('genome')
  })
})
