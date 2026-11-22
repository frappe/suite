// The phone's floating bars (the bottom bar with Compose, and the selection bar with Select All)
// step aside while a list scrolls down, giving it the whole screen, and come back on the first
// scroll up, at the top of the list, and whenever selecting starts or stops.
import { useEventListener, useResizeObserver } from '@vueuse/core'
import {
  computed,
  effectScope,
  onScopeDispose,
  reactive,
  readonly,
  ref,
  watch,
  watchEffect,
  type Ref,
} from 'vue'

import { useMobileSelection } from '@/apps/mail/utils/composables'

// How far a list scrolls one way before the bars follow, so a finger resting on the glass, or a
// short nudge, leaves them be.
const SLACK = 8

const away = ref(false)

export const usePhoneBarsAway = () => readonly(away)

/** Call in the setup of a page whose list runs under the bars. */
export const hidePhoneBarsOnScroll = (list: Ref<HTMLElement | null | undefined>) => {
  let last = 0
  useEventListener(
    list,
    'scroll',
    () => {
      const el = list.value
      if (!el) return
      // Clamped: the rubber band past either end is no scroll the other way.
      const top = Math.min(Math.max(el.scrollTop, 0), el.scrollHeight - el.clientHeight)
      if (top <= 0) away.value = false
      else if (Math.abs(top - last) < SLACK) return
      else away.value = top > last
      last = top
    },
    { passive: true },
  )
  const { isMobileSelectionActive } = useMobileSelection()
  watch(isMobileSelectionActive, () => (away.value = false))
  // The next list, or a page without one (Profile), starts with the bars in place.
  watch(list, () => {
    away.value = false
    last = 0
  })
  onScopeDispose(() => (away.value = false))
}

// Toasts rise above whichever bar is in place, and come back down while it is away. Each bar
// reports how far its island (its last child) stands off the bottom, the safe area included; the
// round button over the island (Compose, Select All) may be covered. The tallest in place wins.
const barHeights = reactive(new Map<symbol, number>())
const lift = computed(() => (away.value ? 0 : Math.max(0, ...barHeights.values())))
let lifting = false

// Outlives the bar that started it, so a bar coming and going leaves it running.
const startLifting = () =>
  effectScope(true).run(() =>
    // Read by the toaster rule in DefaultLayout.
    watchEffect(() => {
      const root = document.documentElement
      root.classList.toggle('mail-phone-bar', lift.value > 0)
      root.style.setProperty('--mail-phone-bar', `${lift.value}px`)
    }),
  )

/** Call in the setup of a phone bar; `bar` is its outermost element, null while it is not shown. */
export const liftToastsOver = (bar: Ref<HTMLElement | null>) => {
  const key = Symbol()
  const measure = (el: HTMLElement) => {
    const island = el.lastElementChild
    barHeights.set(key, el.offsetHeight - (island instanceof HTMLElement ? island.offsetTop : 0))
  }
  useResizeObserver(bar, () => bar.value && measure(bar.value))
  // Measured on showing too, so the first toast need not wait for the observer.
  watch(bar, (el) => (el ? measure(el) : barHeights.delete(key)))
  onScopeDispose(() => barHeights.delete(key))
  if (lifting) return
  lifting = true
  startLifting()
}
