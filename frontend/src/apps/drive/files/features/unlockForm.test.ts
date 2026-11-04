import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import type { UnlockOutcome } from '@/apps/drive/client/unlock'

import { formatWait, useUnlockForm } from './unlockForm'

afterEach(() => {
  vi.useRealTimers()
  sessionStorage.clear()
})

function form(outcomes: UnlockOutcome[], node = 'locked-folder') {
  const unlock = vi.fn(async () => outcomes.shift() ?? { status: 'unlocked' as const })
  const scope = effectScope()
  const state = scope.run(() => useUnlockForm(() => node, { unlock }))!
  return { state, unlock, scope }
}

describe('the unlock form', () => {
  it('says "Wrong password" inline, lets the visitor try again, and clears the password every time', async () => {
    const { state, unlock } = form([{ status: 'wrong-password' }, { status: 'unlocked' }])

    state.password.value = 'guess'
    const first = await state.submit()
    const error = state.message.value
    const afterWrong = state.password.value
    state.password.value = 'open sesame'
    const second = await state.submit()

    expect([first, error, afterWrong, second, state.password.value]).toEqual([
      false,
      'Wrong password',
      '',
      true,
      '',
    ])
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

  it('keeps the lockout through a reload for that node only, and never stores the password', async () => {
    vi.useFakeTimers()
    const before = form([{ status: 'locked-out', retryAfterMs: 600_000 }])
    before.state.password.value = 'guess'
    await before.state.submit()
    before.scope.stop()
    vi.advanceTimersByTime(100_000)

    const reloaded = form([])
    const other = form([], 'another-folder')

    expect([reloaded.state.disabled.value, reloaded.state.message.value]).toEqual([
      true,
      'Try again in 8:20',
    ])
    expect(other.state.disabled.value).toBe(false)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('guess')
    vi.advanceTimersByTime(500_000)
    expect(reloaded.state.disabled.value).toBe(false)
    expect(sessionStorage.length).toBe(0)
    reloaded.scope.stop()
    other.scope.stop()
  })

  it('formats a wait as minutes and seconds, rounding up', () => {
    expect([formatWait(65_000), formatWait(900_000), formatWait(1), formatWait(-5)]).toEqual([
      '1:05',
      '15:00',
      '0:01',
      '0:00',
    ])
  })
})
