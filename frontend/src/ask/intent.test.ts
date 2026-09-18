import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import { classifyQuestion } from './intent'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb
const types = (q: string, n = 1) => classifyQuestion(q, kb, n).map((i) => i.type)

describe('classifyQuestion', () => {
  it('recognises a medication question from a kb drug name alone', () => {
    const [first] = classifyQuestion('Is clopidogrel ok for me?', kb)
    expect(first).toEqual({ type: 'medication', signals: ['clopidogrel'] })
  })
  it('puts the strongest type first and keeps the others', () => {
    expect(types('My LDL cholesterol result is high, could it be genetic?')).toEqual(['labs', 'genetics'])
    expect(types('Pain in both knees since Monday, should I see a doctor?')).toEqual(['symptoms', 'doctor'])
  })
  it('matches stems, phrases, rsids and body parts', () => {
    expect(classifyQuestion('what dose was prescribed', kb)[0].signals).toEqual(['dose', 'prescribed'])
    expect(classifyQuestion('any side effects?', kb)[0].signals).toEqual(['side effect'])
    expect(types('what does rs12345 mean')).toEqual(['genetics'])
    expect(classifyQuestion('my lower back', kb)[0]).toEqual({
      type: 'symptoms',
      signals: ['back', 'lower back'],
    })
  })
  it('treats several selected people as a family question', () => {
    expect(types('what about CYP2C19', 2)).toEqual(['family', 'genetics'])
  })
  it('returns nothing for a question without signals, and short words need an exact match', () => {
    expect(classifyQuestion('hello there', kb)).toEqual([])
    expect(classifyQuestion('in a moment, something general', kb)).toEqual([])
  })
})
