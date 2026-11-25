import { computed, onMounted, onUnmounted, reactive, readonly, shallowReactive, watch } from 'vue'

import { createSwipeGesture, type SwipeOffset } from '@/apps/mail/utils/swipeGesture'

/** Where an open thread stands under the finger: how far it is pulled sideways, and whether it is on
 * its way to rest. */
export interface ThreadSwipe {
  dx: number
  settling: boolean
}

/**
 * One of the threads the pane draws: the open one, or one either side of it (`beside`), drawn
 * already, ready to be pulled in. `key` keeps each one's place in the pane, so the one a swipe brings
 * in becomes the open one where it is, without being drawn again.
 */
export interface ThreadSlot {
  id?: string
  key: string
  beside?: SwipeOffset
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
 * The threads either side are drawn as soon as one opens (`slots`), so the one pulled in is there
 * already, read, and is the open one once it lands. The view says what is either side and how to
 * step there; this owns the gesture, where the page stands and which threads it draws, for the view
 * and MailThread to draw.
 *
 * Touches over a message body happen inside its frame and never reach the pane, so the frame sends
 * each point up and EmailContent re-sends it as an `email-swipe-point` window event, which this
 * listens to as well as the pane's own touches.
 */
export function useThreadSwipe<Pane, Row>({
  enabled,
  open,
  byOffset,
  rowOf,
  step,
}: {
  enabled: () => boolean
  /** The open thread. */
  open: () => string | undefined
  /** The loaded thread that way from the open one, if there is one. */
  byOffset: (offset: SwipeOffset) => string | undefined
  /** The loaded row a slot's thread is drawn from, if it is loaded. */
  rowOf: (id: string | undefined) => Row | undefined
  /** Opens the thread that way. */
  step: (offset: SwipeOffset) => unknown
}) {
  const gesture = createSwipeGesture()
  const swipe = reactive<ThreadSwipe>({ dx: 0, settling: false })
  let settle: ReturnType<typeof setTimeout> | undefined

  function rest() {
    clearTimeout(settle)
    Object.assign(swipe, { dx: 0, settling: false })
  }
  // The thread it went to is in the middle now, where the swipe left it: the page rests in the same
  // render, before it is drawn (a watcher runs before the render it is part of).
  watch(open, rest)

  // Keyed by thread and in list order, so a step keeps the two threads it shares with the last
  // three where they were, in the same order: the one coming in is the element it lands as, and
  // nothing is moved (moving a message's frame would load it again). Off a phone there is one, and
  // one key for every thread: switching draws nothing again, as it always has.
  const slots = computed<ThreadSlot[]>(() => {
    const id = open()
    if (!enabled() || !id) return [{ id, key: 'open' }]
    const prev = byOffset(-1)
    const next = byOffset(1)
    return [
      ...(prev ? [{ id: prev, key: prev, beside: -1 as const }] : []),
      { id, key: id },
      ...(next ? [{ id: next, key: next, beside: 1 as const }] : []),
    ]
  })

  // The open thread's pane, for the view to reach into, whichever slot holds it. Held by slot, not
  // by order: a slot's ref is let go and set again as it is drawn, in no set order among them.
  const panes = shallowReactive(new Map<string, Pane>())
  const holdPane = (slot: ThreadSlot) => (pane: unknown) => {
    if (!pane) {
      panes.delete(slot.key)
      return
    }
    // SAFETY: bound only as the ref of the view's thread pane in that slot.
    panes.set(slot.key, pane as Pane)
  }
  // Each slot with the row its thread is drawn from, for the view to draw
  const slotRows = computed(() => slots.value.map((slot) => ({ ...slot, row: rowOf(slot.id) })))
  const openPane = computed(() => {
    const slot = slots.value.find((each) => !each.beside)
    return (slot && panes.get(slot.key)) ?? null
  })

  function start(x: number, y: number, count: number) {
    // A page still on its way somewhere is left to get there
    if (!enabled() || swipe.settling) return gesture.cancel()
    gesture.start(x, y, performance.now(), count)
  }

  /** True once the gesture is a drag, so the caller can keep the page from scrolling as well. */
  function move(x: number, y: number) {
    const { phase, dx } = gesture.move(x, y, performance.now())
    if (phase !== 'drag') return false
    swipe.dx = byOffset(dx < 0 ? 1 : -1) ? dx : dx * RESIST
    return true
  }

  function end(x: number) {
    if (swipe.settling) return
    const offset = gesture.end(x, performance.now(), window.innerWidth)
    const goes = offset !== null && !!byOffset(offset)
    if (!goes && !swipe.dx) return rest()

    swipe.settling = true
    swipe.dx = goes ? -offset * window.innerWidth : 0
    clearTimeout(settle)
    settle = setTimeout(async () => {
      // Opening it rests the page (see above); this is for a step that went nowhere
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

  return {
    swipe: readonly(swipe),
    slots: slotRows,
    holdPane,
    openPane,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  }
}
