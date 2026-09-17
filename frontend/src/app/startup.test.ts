import { describe, expect, it } from 'vitest'
import { formatDuration, StartupLog, type StepState } from './startup'

describe('StartupLog', () => {
  it('records steps in start order with timings and notifies on each change', async () => {
    let t = 0
    const seen: StepState[][] = []
    const log = new StartupLog(
      (s) => seen.push(s),
      () => t,
    )
    log.begin('engine')
    t = 40
    log.end('engine')
    const kb = log.run('kb', async () => {
      t = 90
      return 'kb'
    })
    expect(await kb).toBe('kb')
    expect(log.steps).toEqual([
      { id: 'engine', startedAt: 0, endedAt: 40, detail: undefined },
      { id: 'kb', startedAt: 40, endedAt: 90, detail: undefined },
    ])
    expect(seen.length).toBe(4)
  })
  it('updates detail of a running step without restarting it', () => {
    let t = 0
    const log = new StartupLog(undefined, () => t)
    log.begin('storage', { attempt: 1, of: 10 })
    t = 300
    log.begin('storage', { attempt: 2, of: 10 })
    expect(log.steps).toEqual([
      { id: 'storage', startedAt: 0, endedAt: null, detail: { attempt: 2, of: 10 } },
    ])
  })
  it('ends a step even when its work fails', async () => {
    const log = new StartupLog(undefined, () => 5)
    await expect(log.run('schema', () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(log.steps[0].endedAt).toBe(5)
  })
})

describe('formatDuration', () => {
  it('picks a readable unit', () => {
    expect(formatDuration(0)).toBe('0 ms')
    expect(formatDuration(849.6)).toBe('850 ms')
    expect(formatDuration(1320)).toBe('1.3 s')
    expect(formatDuration(12_400)).toBe('12 s')
  })
})
