import { describe, expect, it } from 'vitest'
import type { BodySide } from '../types'
import { bodyHeat, bodyKey, heatLevel, onSide, regionCount } from './body'
import { filterHealthLog, NO_FILTER } from './log'

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
  })
})
