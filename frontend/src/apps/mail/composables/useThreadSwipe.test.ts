import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, type App } from 'vue'

import {
  SETTLE_MS,
  useThreadSwipe,
  type ThreadPeek,
  type ThreadSwipe,
} from '@/apps/mail/composables/useThreadSwipe'

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

const NEXT: ThreadPeek = {
  subject: 'Next',
  sender: 'Ann',
  initial: 'A',
  to: 'to Bo',
  receivedAt: '2026-11-24T09:00:00Z',
}

function mountSwipe(peeks: { next?: ThreadPeek | null; prev?: ThreadPeek | null }) {
  const step = vi.fn()
  let handle!: ReturnType<typeof useThreadSwipe>
  app = createApp(
    defineComponent({
      setup() {
        handle = useThreadSwipe({
          enabled: () => true,
          peek: (offset) => (offset > 0 ? peeks.next : peeks.prev),
          step,
        })
        return () => null
      },
    }),
  )
  app.mount(document.createElement('div'))
  const swipe: Readonly<ThreadSwipe> = handle.swipe
  return { ...handle, swipe, step }
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
    const { swipe, step, onTouchStart, onTouchMove, onTouchEnd } = mountSwipe({ next: NEXT })
    onTouchStart(touch(300))
    vi.advanceTimersByTime(100)
    const move = touch(150)
    onTouchMove(move)

    expect(swipe.dx).toBe(-150)
    expect(swipe.next).toEqual(NEXT)
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
    const { swipe, step, onTouchStart, onTouchMove, onTouchEnd } = mountSwipe({ next: NEXT })
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
    const { step } = mountSwipe({ prev: NEXT })
    framePoint('start', 100)
    vi.advanceTimersByTime(100)
    framePoint('move', 250)
    vi.advanceTimersByTime(300)
    framePoint('end', 250)

    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(step).toHaveBeenCalledWith(-1)
  })
})
