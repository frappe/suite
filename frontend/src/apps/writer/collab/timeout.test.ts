import { afterEach, describe, expect, it, vi } from 'vitest'

import { withinTenSeconds } from './timeout'

describe('withinTenSeconds', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves no timer behind once the work settles', async () => {
    vi.useFakeTimers()
    await withinTenSeconds(Promise.resolve())
    expect(vi.getTimerCount()).toBe(0)
  })
})
