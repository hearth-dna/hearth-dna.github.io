import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import { questionTerms, retrieveForQuestion } from './retrieve'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb

describe('retrieveForQuestion', () => {
  it('finds the pharmacogene for a drug question and nothing else', () => {
    const hits = retrieveForQuestion(
      kb,
      'Should Vova worry about clopidogrel given his CYP2C19 status? Compare with BVA.',
    )
    expect([...hits].sort()).toEqual(['rs12248560', 'rs4244285'])
  })
  it('matches conditions with plural/prefix tolerance', () => {
    expect(retrieveForQuestion(kb, 'is there anything about diabetes?')).toContain('rs7903146')
    expect(retrieveForQuestion(kb, 'which statins are safe for me')).toContain('rs4149056')
  })
  it('matches condition synonyms in other languages', () => {
    expect(retrieveForQuestion(kb, 'есть ли риск диабета у мамы?')).toContain('rs7903146')
    expect(retrieveForQuestion(kb, 'anything about heart attack risk')).toContain('rs10757278')
  })
  it('ignores stop words', () => {
    expect(questionTerms('should I worry about this with my family')).toEqual([])
    expect(retrieveForQuestion(kb, 'should I worry about this with my family').size).toBe(0)
  })
})
