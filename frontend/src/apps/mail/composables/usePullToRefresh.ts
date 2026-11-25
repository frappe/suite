import { useEventListener } from '@vueuse/core'
import { computed, ref, watch, type StyleValue } from 'vue'

import { useSyncNow } from '@/apps/mail/composables/useChangeSync'
import { createPullGesture, REFRESH_AT } from '@/apps/mail/utils/pullGesture'

// A refresh that answers at once still shows its spinner this long, so the pull reads as done
// rather than as a flicker.
const MIN_SPIN = 500
// While it refreshes, the list waits this far down, the spinner in the gap above it.
const HOLD_AT = 52
/** How long the list takes to ease back once let go; PullToRefreshIndicator moves with it. */
export const SETTLE_MS = 250

interface Options {
  /** The list's scroller. */
  scroller: () => HTMLElement | null | undefined
  /** Whether a pull can refresh the list now: on a phone, and not while rows are being selected. */
  enabled: () => boolean
  /** Read the list again; the spinner stays until it settles. */
  refresh: () => Promise<unknown>
}

/**
 * Pull to refresh on a phone's thread list. An installed PWA has no browser pull to refresh, so this
 * is the only one there is. With the list at its top, a pull down draws the list after the finger
 * (see pullGesture for the rule), and a spinner fills in the gap it opens; let go far enough and
 * the mail server is asked for its changes, then the list is read again, the list waiting below the
 * spinning spinner till it is in. Bind `listStyle` to the scroller, and the rest to
 * PullToRefreshIndicator, just before it.
 */
export function usePullToRefresh({ scroller, enabled, refresh }: Options) {
  const syncNow = useSyncNow()
  const gesture = createPullGesture()
  /** How far down the list is drawn, in pixels: the gap the spinner sits in. */
  const offset = ref(0)
  /** A finger is on it: the list follows it, without easing. */
  const pulling = ref(false)
  const refreshing = ref(false)
  // Easing back to the top after a pull, when the list still needs its transform to get there.
  const easing = ref(false)
  let easingTimer: ReturnType<typeof setTimeout> | undefined
  const target = computed(() => (enabled() ? scroller() : null))

  const settle = () => {
    pulling.value = false
    if (!offset.value) return
    offset.value = 0
    easing.value = true
    clearTimeout(easingTimer)
    easingTimer = setTimeout(() => (easing.value = false), SETTLE_MS)
  }

  // Turned off mid-pull (a long press that starts selecting rows), the pull lets go without
  // refreshing: its touchend will not come here.
  watch(target, () => {
    if (refreshing.value) return
    gesture.cancel()
    settle()
  })

  useEventListener(
    target,
    'touchstart',
    (event: TouchEvent) => {
      const touch = event.touches[0]
      if (refreshing.value || !touch) return
      gesture.start(
        touch.clientX,
        touch.clientY,
        target.value?.scrollTop ?? 0,
        event.touches.length,
      )
      // A second finger hands the gesture back.
      if (event.touches.length > 1) settle()
    },
    { passive: true },
  )
  useEventListener(
    target,
    'touchmove',
    (event: TouchEvent) => {
      const touch = event.touches[0]
      if (refreshing.value || !touch) return
      const move = gesture.move(touch.clientX, touch.clientY)
      // The list holds still under a pull, or it would rubber-band down along with the spinner.
      if (move.offset > 0 && event.cancelable) event.preventDefault()
      pulling.value = move.offset > 0
      offset.value = move.offset
    },
    { passive: false },
  )
  useEventListener(
    target,
    'touchend',
    () => {
      if (refreshing.value) return
      if (!gesture.end()) return settle()
      pulling.value = false
      refreshing.value = true
      offset.value = HOLD_AT
      const spun = new Promise((resolve) => setTimeout(resolve, MIN_SPIN))
      void Promise.all([syncNow().then(refresh), spun])
        .catch(() => {
          /* The list's own state holds a refusal. */
        })
        .finally(() => {
          refreshing.value = false
          settle()
        })
    },
    { passive: true },
  )
  useEventListener(
    target,
    'touchcancel',
    () => {
      if (refreshing.value) return
      gesture.cancel()
      settle()
    },
    { passive: true },
  )

  // Only while the list is drawn down, or on its way back: a transform at rest would make the
  // scroller a containing block for anything fixed inside it.
  const listStyle = computed<StyleValue>(() =>
    offset.value || easing.value
      ? {
          transform: `translateY(${offset.value}px)`,
          transition: pulling.value ? 'none' : `transform ${SETTLE_MS}ms var(--page-slide-ease)`,
        }
      : undefined,
  )

  return {
    offset,
    pulling,
    refreshing,
    /** How far to the mark a pull has come, 0 to 1; let go at 1, the list refreshes. */
    progress: computed(() => Math.min(offset.value / REFRESH_AT, 1)),
    listStyle,
  }
}
