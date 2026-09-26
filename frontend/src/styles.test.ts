import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(`${__dirname}/styles.css`, 'utf8')

/** The custom properties a rule block declares, as name → value. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as [string, string]),
  )
}

describe('theme tokens', () => {
  it('declares the same dark tokens for "system on a dark device" and "forced dark"', () => {
    const system = css.match(/:root:not\(\[data-theme='light'\]\) \{([^}]*)\}/)?.[1]
    const forced = css.match(/:root\[data-theme='dark'\] \{([^}]*)\}/)?.[1]
    expect(system).toBeTruthy()
    expect(forced).toBeTruthy()
    expect(tokens(forced ?? '')).toEqual(tokens(system ?? ''))
    expect(Object.keys(tokens(system ?? '')).length).toBeGreaterThan(20)
  })
})
