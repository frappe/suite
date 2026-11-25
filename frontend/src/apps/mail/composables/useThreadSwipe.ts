import { onMounted, onUnmounted, reactive, readonly } from 'vue'

import { createSwipeGesture, type SwipeOffset } from '@/apps/mail/utils/swipeGesture'

/** What shows of the thread a swipe is bringing in, before it opens. */
export interface ThreadPeek {
  subject: string
  sender: string
  /** The letter on the sender's avatar, and their picture where they have one. */
  initial: string
  image?: string
  /** Who it went to, as the open message says it (see recipientsSummary). */
  to: string
  receivedAt: string
}

/**
 * Where an open thread stands under the finger: how far it is pulled sideways, whether it is on its
 * way to rest, and the threads either side of it, as they show while it is pulled. A side's peek is
 * undefined where there is no thread that way, and null where there is one still to load.
 */
export interface ThreadSwipe {
  dx: number
  settling: boolean
  next?: ThreadPeek | null
  prev?: ThreadPeek | null
}

/** How long a let-go page takes to come to rest, or to go; MailThread's transition is as long. */
export const SETTLE_MS = 250
// Pulled where there is nothing to go to, the page gives a third as much: it can be felt to stop
const RESIST = 1 / 3

/** One touch point, from the pane or from the message frame it holds (see EmailContent). */
export interface SwipePoint {
  phase: 'start' | 'move' | 'end' | 'cancel'
  x: number
  y: number
  count?: number
}

function inSidewaysScroller(from: Element) {
  for (let el: Element | null = from; el; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue
    const { overflowX } = getComputedStyle(el)
    if (overflowX === 'auto' || overflowX === 'scroll') return true
  }
  return false
}

/**
 * Swipe-to-page on an open thread, on a phone: the thread follows the finger sideways with the next
 * (or previous) thread showing beside it, and let go, either goes on to that one or settles back.
 * The view says what is either side and how to step there; this owns the gesture and where the page
 * stands, for MailThread to draw.
 *
 * Touches over a message body happen inside its frame and never reach the pane, so the frame sends
 * each point up and EmailContent re-sends it as an `email-swipe-point` window event, which this
 * listens to as well as the pane's own touches.
 */
export function useThreadSwipe({
  enabled,
  peek,
  step,
}: {
  enabled: () => boolean
  /** The thread a step that way would open, as it should show coming in. */
  peek: (offset: SwipeOffset) => ThreadPeek | null | undefined
  /** Opens the thread that way. The page stays where the swipe took it until this settles. */
  step: (offset: SwipeOffset) => unknown
}) {
  const gesture = createSwipeGesture()
  const swipe = reactive<ThreadSwipe>({ dx: 0, settling: false })
  let settle: ReturnType<typeof setTimeout> | undefined

  function rest() {
    Object.assign(swipe, { dx: 0, settling: false, next: undefined, prev: undefined })
  }

  function start(x: number, y: number, count: number) {
    // A page still on its way somewhere is left to get there
    if (!enabled() || swipe.settling) return gesture.cancel()
    swipe.next = peek(1)
    swipe.prev = peek(-1)
    gesture.start(x, y, performance.now(), count)
  }

  /** True once the gesture is a drag, so the caller can keep the page from scrolling as well. */
  function move(x: number, y: number) {
    const { phase, dx } = gesture.move(x, y, performance.now())
    if (phase !== 'drag') return false
    const way = dx < 0 ? swipe.next : swipe.prev
    swipe.dx = way === undefined ? dx * RESIST : dx
    return true
  }

  function end(x: number) {
    if (swipe.settling) return
    const offset = gesture.end(x, performance.now(), window.innerWidth)
    const goes = offset !== null && (offset > 0 ? swipe.next : swipe.prev) !== undefined
    if (!goes && !swipe.dx) return rest()

    swipe.settling = true
    swipe.dx = goes ? -offset * window.innerWidth : 0
    clearTimeout(settle)
    settle = setTimeout(async () => {
      // The thread it went to takes the page's place as the page comes back, in the same render
      if (goes) await step(offset)
      rest()
    }, SETTLE_MS)
  }

  function cancel() {
    gesture.cancel()
    end(0)
  }

  function onPoint({ phase, x, y, count = 1 }: SwipePoint) {
    if (phase === 'start') start(x, y, count)
    else if (phase === 'move') move(x, y)
    else if (phase === 'end') end(x)
    else cancel()
  }

  // The pane's own touches. Its touchmove listener is not passive, so a drag stops the scroll. A
  // touch on something that scrolls sideways (a row of attachments) scrolls it instead.
  const onTouchStart = (e: TouchEvent) => {
    if (e.target instanceof Element && inSidewaysScroller(e.target)) return gesture.cancel()
    start(e.touches[0]!.screenX, e.touches[0]!.screenY, e.touches.length)
  }
  const onTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0]
    if (touch && move(touch.screenX, touch.screenY) && e.cancelable) e.preventDefault()
  }
  const onTouchEnd = (e: TouchEvent) => end(e.changedTouches[0]!.screenX)
  const onTouchCancel = () => cancel()

  const onFramePoint = (e: Event) => {
    if (!(e instanceof CustomEvent)) return
    // SAFETY: EmailContent sends this event only with the point its own frame posted, checked there.
    const point = e.detail as SwipePoint
    onPoint(point)
  }
  onMounted(() => window.addEventListener('email-swipe-point', onFramePoint))
  onUnmounted(() => {
    window.removeEventListener('email-swipe-point', onFramePoint)
    clearTimeout(settle)
  })

  return { swipe: readonly(swipe), onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
