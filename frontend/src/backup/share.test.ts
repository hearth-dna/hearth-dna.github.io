import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBytes } from '../export/exportDump'
import { canShareFiles, shareOrDownload } from './share'

vi.mock('../export/exportDump', () => ({ downloadBytes: vi.fn() }))

const bytes = new Uint8Array([1, 2, 3])

describe('shareOrDownload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(downloadBytes).mockClear()
  })

  it('shares the file when the browser can', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { canShare: () => true, share })
    expect(canShareFiles()).toBe(true)
    expect(await shareOrDownload(bytes, 'b.hearth')).toBe('shared')
    const file = share.mock.calls[0][0].files[0] as File
    expect(file.name).toBe('b.hearth')
    expect(file.size).toBe(3)
    expect(downloadBytes).not.toHaveBeenCalled()
  })

  it('downloads when files cannot be shared', async () => {
    vi.stubGlobal('navigator', { canShare: () => false, share: vi.fn() })
    expect(canShareFiles()).toBe(false)
    expect(await shareOrDownload(bytes, 'b.hearth')).toBe('downloaded')
    expect(downloadBytes).toHaveBeenCalledWith(bytes, 'b.hearth')
  })

  it('downloads when there is no Web Share at all', async () => {
    vi.stubGlobal('navigator', {})
    expect(canShareFiles()).toBe(false)
    expect(await shareOrDownload(bytes, 'b.hearth')).toBe('downloaded')
  })

  it('lets a closed sheet through to the caller', async () => {
    const abort = new DOMException('closed', 'AbortError')
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(abort) })
    await expect(shareOrDownload(bytes, 'b.hearth')).rejects.toBe(abort)
    expect(downloadBytes).not.toHaveBeenCalled()
  })
})
