import { afterEach, describe, expect, it, vi } from 'vitest'

import { observePreviewRefresh } from './previewRefresh'

afterEach(() => vi.useRealTimers())

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
})
