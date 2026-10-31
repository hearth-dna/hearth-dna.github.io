import { describe, expect, it } from 'vitest'
import type { BodySide } from '../types'
import { bodyHeat, bodyKey, heatLevel, onSide, regionCount, teethHeat } from './body'
import { filterHealthLog, NO_FILTER } from './log'
import { defaultBodyPart, findPreset } from './presets'

const at = (bodyPart: string, side: BodySide = '') => ({ bodyPart, side })

describe('body map', () => {
  it('reads a typed body part as the suggested one', () => {
    expect(bodyKey(' Knee ')).toBe('knees')
    expect(bodyKey('foot')).toBe('feet')
    expect(bodyKey('Teeth')).toBe('mouth')
    expect(bodyKey('LOWER  back')).toBe('lower back')
    expect(bodyKey('Колено')).toBe('колено')
    expect(bodyKey('')).toBe('')
  })

  it('counts each part, and each side of a paired one with both and unrecorded sides on either', () => {
    const heat = bodyHeat([
      at('knees', 'left'),
      at('Knee', 'both'),
      at('knees'),
      at('knees', 'right'),
      at('head'),
      at(''),
    ])
    expect(regionCount(heat, 'knees')).toBe(4)
    expect(regionCount(heat, 'knees', 'left')).toBe(3)
    expect(regionCount(heat, 'knees', 'right')).toBe(3)
    expect(regionCount(heat, 'head')).toBe(1)
    expect(regionCount(heat, 'feet', 'left')).toBe(0)
    expect(heat.max).toBe(3)
    expect([...heat.parts.keys()].sort()).toEqual(['head', 'knees'])
  })

  it('scales the colour to the busiest part', () => {
    expect([0, 1, 2, 3, 10].map((n) => heatLevel(n, 10))).toEqual([0, 1, 1, 2, 5])
    expect(heatLevel(1, 0)).toBe(5)
    expect(onSide('', 'left')).toBe(true)
    expect(onSide('right', 'left')).toBe(false)
  })

  it('filters the log the way the map counts it', () => {
    const base = {
      personId: 'p',
      date: '2026-10-01',
      time: '',
      kind: 'symptom' as const,
      title: 'Pain',
      body: '',
      source: '',
      severity: null,
      tags: [],
      value: null,
      value2: null,
      unit: '',
      analyte: '',
      refLow: null,
      refHigh: null,
      flag: '' as const,
      valueText: '',
      conditions: [],
      details: {},
      createdAt: '',
    }
    const log = [
      { ...base, id: 'l', bodyPart: 'knees', side: 'left' as const },
      { ...base, id: 'r', bodyPart: 'Knee', side: 'right' as const },
      { ...base, id: 'n', bodyPart: 'knee', side: '' as const },
      { ...base, id: 'h', bodyPart: 'head', side: '' as const },
    ]
    const ids = (f: Partial<typeof NO_FILTER>) =>
      filterHealthLog(log, { ...NO_FILTER, ...f }).map((e) => e.id)
    expect(ids({ bodyPart: 'knees' })).toEqual(['l', 'r', 'n'])
    expect(ids({ bodyPart: 'knees', side: 'left' })).toEqual(['l', 'n'])
    expect(ids({ bodyPart: 'knees', side: 'left' }).length).toBe(regionCount(bodyHeat(log), 'knees', 'left'))
    const dental = [{ ...log[0], id: 'd', details: { teeth: '16 26' } }, ...log]
    expect(filterHealthLog(dental, { ...NO_FILTER, tooth: 26 }).map((e) => e.id)).toEqual(['d'])
  })

  it('counts entries per tooth, and filters the log to one', () => {
    const teeth: { details: Record<string, string> }[] = [
      { details: { teeth: '16 26' } },
      { details: { teeth: '16 55' } },
      { details: {} },
    ]
    expect([...teethHeat(teeth)].sort()).toEqual([
      [16, 2],
      [26, 1],
      [55, 1],
    ])
  })

  it('starts a preset where the person usually puts it, else where the preset says', () => {
    const temp = findPreset('temperature')!
    const t = (bodyPart: string) => ({ kind: 'measurement', title: 'Body temperature', bodyPart })
    expect(defaultBodyPart(temp, [])).toBe('armpit')
    expect(defaultBodyPart(temp, [t('mouth'), t('armpit'), t('mouth'), t('')])).toBe('mouth')
    // A tie goes to the latest (the log is newest first).
    expect(defaultBodyPart(temp, [t('ears'), t('mouth')])).toBe('ears')
    // Other presets' places do not count.
    expect(defaultBodyPart(temp, [{ kind: 'symptom', title: 'Headache', bodyPart: 'head' }])).toBe('armpit')
    expect(defaultBodyPart(findPreset('weight')!, [])).toBe('')
  })
})
