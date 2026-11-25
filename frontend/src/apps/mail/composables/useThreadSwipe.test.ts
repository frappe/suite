import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, ref, type App } from 'vue'

import { SETTLE_MS, useThreadSwipe, type ThreadSwipe } from '@/apps/mail/composables/useThreadSwipe'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

let app: App | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  window.innerWidth = 400
})
afterEach(() => {
  app?.unmount()
  vi.useRealTimers()
})

/** A list of threads with one open; a step opens the one that way, as the views' do. */
function mountSwipe(ids: string[], openAt: string, { phone = true } = {}) {
  const open = ref(openAt)
  const phoneRef = ref(phone)
  const byOffset = (offset: number) => ids[ids.indexOf(open.value) + offset]
  const step = vi.fn((offset: number) => {
    open.value = byOffset(offset)!
  })
  let handle!: ReturnType<typeof useThreadSwipe>
  app = createApp(
    defineComponent({
      setup() {
        handle = useThreadSwipe({
          enabled: () => phoneRef.value,
          open: () => open.value,
          byOffset,
          rowOf: (id) => id,
          step,
        })
        return () => null
      },
    }),
  )
  app.mount(document.createElement('div'))
  const swipe: Readonly<ThreadSwipe> = handle.swipe
  return { ...handle, swipe, step, open }
}

// A touch on the pane, as the browser hands it over.
const touch = (x: number, y = 400) => {
  const point = { screenX: x, screenY: y }
  return fromPartial<TouchEvent>({
    touches: fromPartial([point]),
    changedTouches: fromPartial([point]),
    target: document.body,
    cancelable: true,
    preventDefault: vi.fn(),
  })
}

// A point the message frame sent up (see EmailContent).
const framePoint = (phase: string, x: number, y = 400) =>
  window.dispatchEvent(new CustomEvent('email-swipe-point', { detail: { phase, x, y } }))

describe('useThreadSwipe', () => {
  it('follows the finger, then opens the next thread once the page has gone', async () => {
    const { swipe, step, onTouchStart, onTouchMove, onTouchEnd } = mountSwipe(['a', 'b'], 'a')
    onTouchStart(touch(300))
    vi.advanceTimersByTime(100)
    const move = touch(150)
    onTouchMove(move)

    expect(swipe.dx).toBe(-150)
    expect(move.preventDefault).toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    onTouchEnd(touch(150))
    expect(swipe.dx).toBe(-400)
    expect(step).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(step).toHaveBeenCalledWith(1)
    expect(swipe).toMatchObject({ dx: 0, settling: false })
  })

  it('gives only a little where there is no thread that way, and stays put', async () => {
    const { swipe, step, onTouchStart, onTouchMove, onTouchEnd } = mountSwipe(['a', 'b'], 'a')
    onTouchStart(touch(100))
    vi.advanceTimersByTime(100)
    onTouchMove(touch(250))

    expect(swipe.dx).toBe(50)

    vi.advanceTimersByTime(300)
    onTouchEnd(touch(250))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(step).not.toHaveBeenCalled()
    expect(swipe.dx).toBe(0)
  })

  it('pages from a swipe over a message body too', async () => {
    const { step } = mountSwipe(['a', 'b'], 'b')
    framePoint('start', 100)
    vi.advanceTimersByTime(100)
    framePoint('move', 250)
    vi.advanceTimersByTime(300)
    framePoint('end', 250)

    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(step).toHaveBeenCalledWith(-1)
  })

  it('draws the threads either side, and the one stepped to stays where it was drawn', async () => {
    const { slots, open } = mountSwipe(['a', 'b', 'c', 'd'], 'b')
    const before = slots.value
    expect(Object.fromEntries(before.map((slot) => [slot.id, slot.beside]))).toEqual({
      a: -1,
      b: undefined,
      c: 1,
    })

    open.value = 'c'
    await nextTick()
    const after = slots.value
    expect(Object.fromEntries(after.map((slot) => [slot.id, slot.beside]))).toEqual({
      b: -1,
      c: undefined,
      d: 1,
    })
    // b and c are the same slots, in the same order: neither is drawn again or moved
    const kept = (list: typeof before) =>
      list.filter((slot) => slot.id === 'b' || slot.id === 'c').map((slot) => slot.key)
    expect(kept(after)).toEqual(kept(before))
  })

  it('keeps one slot for every thread off a phone, so switching draws nothing again', async () => {
    const { slots, open } = mountSwipe(['a', 'b'], 'a', { phone: false })
    const key = slots.value[0]!.key
    open.value = 'b'
    await nextTick()
    expect(slots.value).toEqual([{ id: 'b', key, row: 'b' }])
  })
})
