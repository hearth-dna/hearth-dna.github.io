import { describe, expect, it } from 'vitest'
import { fits, HEADROOM, MAX_TOTAL_BYTES, megabytes, totalFits, usageLine } from './quota'

describe('fits', () => {
  it('demands headroom beyond the file itself', () => {
    // A file only fits when HEADROOM times its size is free.
    expect(fits({ quota: 1000, usage: 0 }, 1000 / HEADROOM + 1)).toBe(false)
    expect(fits({ quota: 1000, usage: 0 }, 1000 / HEADROOM - 1)).toBe(true)
    expect(fits({ quota: 1000, usage: 700 }, 100)).toBe(false)
  })

  it('allows the write when the browser will not estimate', () => {
    // Firefox and older WebViews: the QuotaExceededError on write is the real defence.
    expect(fits(null, 10_000_000)).toBe(true)
    expect(fits({}, 10_000_000)).toBe(true)
    expect(fits({ quota: 100 }, 10_000_000)).toBe(true)
  })
})

describe('totalFits', () => {
  it('holds the app ceiling', () => {
    expect(totalFits(0, MAX_TOTAL_BYTES)).toBe(true)
    expect(totalFits(1, MAX_TOTAL_BYTES)).toBe(false)
  })
})

describe('usageLine', () => {
  it('warns from four fifths full', () => {
    expect(usageLine({ quota: 100, usage: 79 })?.nearFull).toBe(false)
    expect(usageLine({ quota: 100, usage: 80 })?.nearFull).toBe(true)
    expect(usageLine(null)).toBeNull()
    expect(usageLine({ usage: 5 })).toBeNull()
  })
})

describe('megabytes', () => {
  it('rounds to one decimal', () => {
    expect(megabytes(1024 * 1024)).toBe(1)
    expect(megabytes(1024 * 1024 * 1.55)).toBe(1.6)
  })
})
