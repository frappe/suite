import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

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

// A list at its top, on the screen `screen` names; `again()` pulls it well past the mark and lets go.
const pullDown = async (refresh: () => Promise<unknown>, screen = ref('/inbox')) => {
  const list = document.createElement('div')
  const pull = scope.run(() =>
    usePullToRefresh({
      scroller: () => list,
      enabled: () => true,
      refresh,
      screen: () => screen.value,
    }),
  )!
  await nextTick()
  const again = () => {
    touch(list, 'touchstart', 100)
    for (let y = 110; y <= 400; y += 10) touch(list, 'touchmove', y)
    touch(list, 'touchend')
  }
  again()
  return Object.assign(pull, { again })
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

  it("lets the spinner go on another screen, and a later pull's spinner stays", async () => {
    // A phone on a poor line: the Inbox's read is still out when Search opens in the same view.
    const screen = ref('/inbox')
    const pull = await pullDown(never, screen)

    screen.value = '/search'
    await nextTick()
    expect(pull.refreshing.value).toBe(false)
    expect(pull.offset.value).toBe(0)

    await vi.advanceTimersByTimeAsync(10_000)
    pull.again()
    // The Inbox's read gives up now; Search's own goes on.
    await vi.advanceTimersByTimeAsync(6_000)

    expect(pull.refreshing.value).toBe(true)
  })
})
