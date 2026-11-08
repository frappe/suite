import { afterEach, describe, expect, it, vi } from 'vitest'

import { observePreviewRefresh } from './previewRefresh'

afterEach(() => {
  vi.useRealTimers()
})

const MINUTE = 60_000
const START = Date.UTC(2026, 10, 6, 9, 0)

/** A grid whose server signs each preview for 15 minutes from `serverNow()`. */
function grid(serverNow = () => Date.now()) {
  const preview = { expires: 0 }
  const rows = [{ preview }, { preview: null }]
  const sign = () => (preview.expires = Math.floor(serverNow() / 1000) + 15 * 60)
  sign()
  const refresh = vi.fn(() => {
    sign()
  })
  return { rows, refresh }
}

const focus = () => window.dispatchEvent(new Event('focus'))

describe('preview refresh', () => {
  it('refreshes an open preview signed URL every 10 minutes and stops when closed', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    const close = observePreviewRefresh({ refresh })

    vi.advanceTimersByTime(599_999)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(600_000)
    expect(refresh).toHaveBeenCalledTimes(2)

    close()
    vi.advanceTimersByTime(1_800_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('leaves fresh thumbnails alone on focus, and renews them shortly before they expire', () => {
    vi.useFakeTimers({ now: START })
    const { rows, refresh } = grid()
    const close = observePreviewRefresh({ refresh, rows: () => rows })

    vi.advanceTimersByTime(10 * MINUTE)
    focus()
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3 * MINUTE)
    expect(refresh).toHaveBeenCalledTimes(1)
    focus()
    expect(refresh).toHaveBeenCalledTimes(1)
    close()
  })

  it('never refreshes a page with no thumbnails on it', () => {
    vi.useFakeTimers({ now: START })
    const rows = [{ preview: null }]
    const refresh = vi.fn()
    const close = observePreviewRefresh({ refresh, rows: () => rows })

    focus()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(refresh).not.toHaveBeenCalled()
    close()
  })

  it('still renews thumbnails in time when the browser clock is behind or ahead of the server', async () => {
    for (const offset of [-10 * MINUTE, 30 * MINUTE]) {
      vi.useFakeTimers({ now: START })
      const { rows, refresh } = grid(() => Date.now() - offset)
      const close = observePreviewRefresh({ refresh, rows: () => rows })

      await vi.advanceTimersByTimeAsync(60 * MINUTE)
      // Every 13 minutes at most, so each URL is renewed within its 15 minutes.
      expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(4)
      expect(refresh.mock.calls.length).toBeLessThanOrEqual(5)
      close()
      vi.useRealTimers()
    }
  })
})
