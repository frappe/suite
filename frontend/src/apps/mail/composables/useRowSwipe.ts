import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  readonly,
  shallowRef,
  type Component,
  type Ref,
} from 'vue'

import { COMMIT_SHARE, createSwipeGesture } from '@/apps/mail/utils/swipeGesture'

/** Which way the finger takes the row. */
export type SwipeSide = 'left' | 'right'

/** What a swipe one way does, as the row shows it behind itself. */
export interface RowSwipeAction {
  icon: Component
  /** A word or two for it, under the icon. */
  label: string
  /** The colour behind the row: red for what lets go of the mail, grey for what files it. */
  tone: 'red' | 'gray'
  /**
   * It asks before it does anything (deleting for good): the row comes back while it asks, and only
   * leaves the list if the answer is yes.
   */
  asks?: boolean
}

/** How long each step of a let-go row takes: coming back, going out, closing up. */
export const ROW_SWIPE_MS = 200
// How long a row that went waits for the list to drop it before it takes itself to be kept.
const KEPT_AFTER_MS = 1500

// One row moves at a time: a touch on another row while one is dragged, or on its way, is a scroll.
let moving: symbol | null = null

/**
 * A mail row's swipes, on a phone: the row follows the finger sideways with what the swipe does
 * showing behind it. Let go short of the threshold, it comes back. Past it (or flung), it slides out,
 * the space it took closes up, and then the action runs, which takes it off the list: closing up
 * first is what keeps the rows under it from jumping. If the list still has the row a while later (a
 * folder that keeps it), it opens up again and comes back. An action that asks first has the row
 * come back while it asks.
 * The drag and scroll lock and the threshold are the thread swipe's (see swipeGesture).
 */
export function useRowSwipe({
  el,
  enabled,
  action,
  commit,
}: {
  /** The row's box: its width is the swipe's measure, and its height what closes up. */
  el: Ref<HTMLElement | null>
  enabled: () => boolean
  /** What a swipe that way does, if anything. */
  action: (side: SwipeSide) => RowSwipeAction | undefined
  commit: (side: SwipeSide) => void
}) {
  const me = Symbol('row')
  const gesture = createSwipeGesture()
  const state = reactive<{
    dx: number
    settling: boolean
    // The box's height while it closes up or opens again; none at rest.
    height: number | null
  }>({ dx: 0, settling: false, height: null })
  // The way the row last went, and what that does, held until it rests: on its way back the row is
  // already headed for 0, and what shows behind it must stay till it gets there.
  const lastSide = shallowRef<SwipeSide | null>(null)
  const held = shallowRef<RowSwipeAction>()
  let width = 0
  let dragging = false
  // Set on the touch's end: the click the browser may still send for it opens nothing.
  let dragged = false
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined

  const side = computed<SwipeSide | null>(() => {
    if (state.dx) return state.dx < 0 ? 'left' : 'right'
    return state.settling ? lastSide.value : null
  })
  const shown = computed(() => held.value ?? (side.value ? action(side.value) : undefined))
  /** Past the threshold: let go now, it does it. */
  const armed = computed(() => !!width && Math.abs(state.dx) >= width * COMMIT_SHARE)
  const boxStyle = computed(() =>
    state.height === null
      ? undefined
      : {
          height: `${String(state.height)}px`,
          overflow: 'hidden',
          transition: `height ${String(ROW_SWIPE_MS)}ms ease-out`,
        },
  )

  const after = (ms: number, then: () => void) => {
    clearTimeout(timer)
    timer = setTimeout(then, ms)
  }

  function rest() {
    clearTimeout(timer)
    Object.assign(state, { dx: 0, settling: false, height: null })
    lastSide.value = null
    held.value = undefined
    if (moving === me) moving = null
  }

  function settle(dx: number, then: () => void) {
    Object.assign(state, { dx, settling: true })
    after(ROW_SWIPE_MS, then)
  }

  // Out the way it went, then its space closes up (from its height to none, as a transition: the box
  // is drawn at its height first), and then the action runs.
  function go(to: SwipeSide) {
    settle(to === 'left' ? -width : width, async () => {
      const box = el.value
      const height = box?.offsetHeight ?? 0
      state.height = height
      await nextTick()
      if (!alive) return
      void box?.offsetHeight
      state.height = 0
      after(ROW_SWIPE_MS, () => {
        commit(to)
        // Done with the finger: another row can swipe while this one waits to leave or comes back
        if (moving === me) moving = null
        // The list lets go of the row once its copy of the list is updated, a frame to half a second
        // later. One still here long after that is a row this list keeps (a folder that also holds
        // it): it opens up again and comes back.
        after(KEPT_AFTER_MS, () => {
          state.height = height
          after(ROW_SWIPE_MS, () => {
            state.height = null
            settle(0, rest)
          })
        })
      })
    })
  }

  function onTouchStart(e: TouchEvent) {
    dragged = false
    const touch = e.touches[0]
    // Nor while this row is on its way somewhere
    const busy = state.settling || state.height !== null
    if (!enabled() || moving || busy || !el.value || !touch) return gesture.cancel()
    width = el.value.offsetWidth
    gesture.start(touch.clientX, touch.clientY, performance.now(), e.touches.length)
  }

  // Bound without `passive`, so a drag stops the list scrolling under it
  function onTouchMove(e: TouchEvent) {
    const touch = e.touches[0]
    if (!touch) return
    const move = gesture.move(touch.clientX, touch.clientY, performance.now())
    if (move.phase !== 'drag') return
    if (moving && moving !== me) return gesture.cancel()
    moving = me
    dragging = true
    if (e.cancelable) e.preventDefault()
    const way = move.dx < 0 ? 'left' : 'right'
    // A way with nothing to do holds the row where it is
    state.dx = action(way) ? move.dx : 0
    if (state.dx) lastSide.value = way
  }

  function onTouchEnd(e: TouchEvent) {
    const x = e.changedTouches[0]?.clientX ?? 0
    const offset = gesture.end(x, performance.now(), width)
    if (!dragging) return
    dragging = false
    dragged = true

    const to: SwipeSide | null = offset === 1 ? 'left' : offset === -1 ? 'right' : null
    const does = to ? action(to) : undefined
    if (!to || !does) return settle(0, rest)
    held.value = does
    lastSide.value = to
    if (does.asks) {
      settle(0, rest)
      return commit(to)
    }
    go(to)
  }

  function onTouchCancel() {
    gesture.cancel()
    if (!dragging) return
    dragging = false
    settle(0, rest)
  }

  onBeforeUnmount(() => {
    alive = false
    clearTimeout(timer)
    if (moving === me) moving = null
  })

  return {
    swipe: readonly(state),
    side,
    shown,
    armed,
    boxStyle,
    /** The touch that just ended dragged the row: its click is not a tap. */
    wasDragged: () => dragged,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  }
}
