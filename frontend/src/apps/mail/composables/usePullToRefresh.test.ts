import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { usePullToRefresh } from '@/apps/mail/composables/usePullToRefresh'

// The mail server's changes, asked for before the list is read again.
const sync = vi.hoisted(() => ({ now: (): Promise<void> => Promise.resolve() }))
vi.mock('@/apps/mail/composables/useChangeSync', () => ({ useSyncNow: () => () => sync.now() }))

// Never answers, as a request a phone left hanging when it put the app away.
const never = () => new Promise<void>(() => {})

let scope = effectScope()

beforeEach(() => {
  scope = effectScope()
  vi.useFakeTimers()
  sync.now = () => Promise.resolve()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

const touch = (list: HTMLElement, type: string, y?: number) => {
  const event = new Event(type, { cancelable: true })
  const touches = y === undefined ? [] : [{ clientX: 100, clientY: y }]
  Object.defineProperty(event, 'touches', { value: touches })
  list.dispatchEvent(event)
}

// A list at its top, pulled well past the mark and let go.
const pullDown = async (refresh: () => Promise<unknown>) => {
  const list = document.createElement('div')
  const pull = scope.run(() =>
    usePullToRefresh({ scroller: () => list, enabled: () => true, refresh }),
  )!
  await nextTick()
  touch(list, 'touchstart', 100)
  for (let y = 110; y <= 400; y += 10) touch(list, 'touchmove', y)
  touch(list, 'touchend')
  return pull
}

describe('usePullToRefresh', () => {
  it('reads the list again even while the ask for changes never answers', async () => {
    sync.now = never
    const refresh = vi.fn(() => Promise.resolve())
    const pull = await pullDown(refresh)
    expect(pull.refreshing.value).toBe(true)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(refresh).toHaveBeenCalled()
    expect(pull.refreshing.value).toBe(false)
  })

  it('lets the list back up when its read never answers', async () => {
    const pull = await pullDown(never)
    expect(pull.refreshing.value).toBe(true)

    await vi.advanceTimersByTimeAsync(20_000)

    expect(pull.refreshing.value).toBe(false)
    expect(pull.offset.value).toBe(0)
  })
})
