import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mobileFigures, simplePath } from './mobileFigures'

const FILE = `${__dirname}/../../../mobile/body-figures.json`

describe('mobile figures', () => {
  it('writes paths in M, L, C, Q and Z only, arcs as curves', () => {
    const id = (p: [number, number]): [number, number] => p
    expect(simplePath('M0 0l10 0h5v5Z', id)).toBe('M0 0L10 0L15 0L15 5Z')
    // A half circle of radius 5 from (0,0) to (10,0): two quarter turns, ending on the point.
    const half = simplePath('M0 0A5 5 0 0 1 10 0', id)
    expect(half.match(/C/g)?.length).toBe(2)
    expect(half.endsWith('10 0')).toBe(true)
    expect(half).toMatch(/ 5 -5C/)
  })

  // Run with UPDATE_MOBILE_FIGURES=1 after changing a figure, then commit the file.
  it('matches the committed file the phone apps draw', () => {
    const json = `${JSON.stringify(mobileFigures())}\n`
    if (process.env.UPDATE_MOBILE_FIGURES) writeFileSync(FILE, json)
    const stale = !existsSync(FILE) || readFileSync(FILE, 'utf8') !== json
    expect(
      stale,
      'mobile/body-figures.json is stale: UPDATE_MOBILE_FIGURES=1 npx vitest run mobileFigures',
    ).toBe(false)
  })
})
