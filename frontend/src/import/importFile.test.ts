import { describe, expect, it } from 'vitest'
import { personFromFileName } from './importFile'

describe('personFromFileName', () => {
  it('derives a label and keeps the stem as display name', () => {
    expect(personFromFileName('AncestryDNA (1).txt')).toEqual({
      label: 'ancestrydna-1',
      displayName: 'AncestryDNA (1)',
    })
    expect(personFromFileName('vova_23andme.txt.zip')).toEqual({
      label: 'vova-23andme',
      displayName: 'vova_23andme',
    })
    expect(personFromFileName('genome_Polina.csv.gz')).toEqual({
      label: 'genome-polina',
      displayName: 'genome_Polina',
    })
  })
  it('never yields an empty label', () => {
    expect(personFromFileName('.txt').label).toBe('genome')
  })
})
