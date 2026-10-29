import { describe, expect, it } from 'vitest'
import { type HealthPreset, presetNamed, presetOrder, searchPresets } from './presets'

const symptoms = presetOrder(['symptom'], [])
const measurements = presetOrder(['measurement'], [])
// A translated name stands in for the UI language.
const shown = (p: HealthPreset) => (p.id === 'cough' ? 'Кашель' : p.title)
const ids = (ps: HealthPreset[]) => ps.map((p) => p.id)

describe('preset search', () => {
  it('finds by the start of a name, a word, a synonym or the translation', () => {
    expect(ids(searchPresets(symptoms, 'runny', shown))[0]).toBe('runny-nose')
    expect(ids(searchPresets(symptoms, 'nose', shown))).toContain('runny-nose')
    expect(ids(searchPresets(symptoms, 'tummy', shown))).toEqual(['stomach-ache'])
    expect(ids(searchPresets(symptoms, 'каш', shown))).toEqual(['cough'])
    expect(ids(searchPresets(measurements, 'pulse', shown))).toEqual(['heart-rate'])
  })

  it('lists names that start with the text before ones that only contain it', () => {
    const found = ids(searchPresets(symptoms, 'ache', shown))
    expect(found.indexOf('stomach-ache')).toBeGreaterThan(-1)
    expect(searchPresets(symptoms, '', shown)).toBe(symptoms)
    expect(searchPresets(symptoms, 'zzzz', shown)).toEqual([])
  })

  it('takes a whole name, title or synonym as that preset, and nothing else', () => {
    expect(presetNamed(symptoms, ' кашель ', shown)?.id).toBe('cough')
    expect(presetNamed(symptoms, 'Cough', shown)?.id).toBe('cough')
    expect(presetNamed(symptoms, 'tummy ache', shown)?.id).toBe('stomach-ache')
    expect(presetNamed(symptoms, 'runny', shown)).toBeUndefined()
    expect(presetNamed(symptoms, '', shown)).toBeUndefined()
  })
})

describe('the quick symptom bar', () => {
  const both = presetOrder(['symptom', 'procedure'], [])

  it('offers treatments and checkups beside the symptoms, each saved as its own kind', () => {
    expect(presetNamed(both, 'teeth cleaning', shown)?.kind).toBe('procedure')
    expect(presetNamed(both, 'Чистка зубов', shown)?.id).toBe('teeth-cleaning')
    expect(presetNamed(both, 'Cough', shown)?.kind).toBe('symptom')
    expect(ids(searchPresets(both, 'dental', shown))).toEqual(
      expect.arrayContaining(['teeth-cleaning', 'dental-checkup', 'dental-filling']),
    )
  })

  it('puts the last procedure recorded first, and no name stands for two presets', () => {
    const order = presetOrder(
      ['symptom', 'procedure'],
      [
        { kind: 'procedure', title: 'Eye exam' },
        { kind: 'symptom', title: 'Cough' },
      ],
    )
    expect(ids(order.slice(0, 2))).toEqual(['eye-exam', 'cough'])
    const names = both.flatMap((p) => [
      ...new Set([p.title, ...(p.synonyms ?? [])].map((n) => n.toLowerCase())),
    ])
    expect(new Set(names).size).toBe(names.length)
  })
})
