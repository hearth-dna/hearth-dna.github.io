import { describe, expect, it } from 'vitest'
import type { HealthEntry } from '../types'
import { importBatches } from './history'

const e = (source: string, date: string, kind: HealthEntry['kind'], createdAt: string) =>
  ({ source, date, kind, createdAt }) as HealthEntry

describe('importBatches', () => {
  it('groups entries by import, newest import first, and leaves typed entries out', () => {
    const batches = importBatches([
      e('csv:aaa', '2026-01-05', 'measurement', '2026-09-20T10:00:00Z'),
      e('csv:aaa', '2026-01-26', 'measurement', '2026-09-20T10:00:00Z'),
      e('csv:aaa', '2026-01-12', 'lab', '2026-09-20T10:00:00Z'),
      e('gemini:gemini-2.5-flash:bbb', '2026-09-17', 'lab', '2026-09-24T08:00:00Z'),
      e('text:ccc', '2026-09-18', 'lab', '2026-09-22T08:00:00Z'),
      e('', '2026-09-01', 'symptom', '2026-09-01T08:00:00Z'),
    ])
    expect(batches.map((b) => [b.via, b.model, b.count])).toEqual([
      ['gemini', 'gemini-2.5-flash', 1],
      ['text', '', 1],
      ['csv', '', 3],
    ])
    expect(batches[2]).toMatchObject({
      from: '2026-01-05',
      to: '2026-01-26',
      kinds: { measurement: 2, lab: 1 },
    })
  })
})
