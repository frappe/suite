import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import type { UnlockOutcome } from '@/apps/drive/client/unlock'
import { formatWait, useUnlockForm } from './unlockForm'

afterEach(() => vi.useRealTimers())

function form(outcomes: UnlockOutcome[]) {
  const unlock = vi.fn(async () => outcomes.shift() ?? { status: 'unlocked' as const })
  const scope = effectScope()
  const state = scope.run(() => useUnlockForm(() => 'locked-folder', { unlock }))!
  return { state, unlock, scope }
}

describe('the unlock form', () => {
  it('says "Wrong password" inline and lets the visitor try again', async () => {
    const { state, unlock } = form([{ status: 'wrong-password' }, { status: 'unlocked' }])

    state.password.value = 'guess'
    const first = await state.submit()
    const error = state.message.value
    state.password.value = 'open sesame'
    const second = await state.submit()

    expect([first, error, second]).toEqual([false, 'Wrong password', true])
    expect(unlock).toHaveBeenLastCalledWith('locked-folder', 'open sesame')
  })

  it('disables the form during a lockout and counts down to the next try', async () => {
    vi.useFakeTimers()
    const { state, unlock, scope } = form([{ status: 'locked-out', retryAfterMs: 872_000 }])

    state.password.value = 'guess'
    await state.submit()
    const locked = [state.disabled.value, state.message.value]
    vi.advanceTimersByTime(60_000)
    const later = state.message.value
    state.password.value = 'again'
    await state.submit()
    vi.advanceTimersByTime(812_000)

    expect(locked).toEqual([true, 'Try again in 14:32'])
    expect(later).toBe('Try again in 13:32')
    expect(unlock).toHaveBeenCalledOnce()
    expect([state.disabled.value, state.message.value]).toEqual([false, ''])
    scope.stop()
  })

  it('formats a wait as minutes and seconds, rounding up', () => {
    expect([formatWait(65_000), formatWait(900_000), formatWait(1), formatWait(-5)]).toEqual([
      '1:05', '15:00', '0:01', '0:00',
    ])
  })
})
