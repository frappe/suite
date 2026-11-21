// The phone's floating bars (the bottom bar with Compose, and the selection bar with Select All)
// step aside while a list scrolls down, giving it the whole screen, and come back on the first
// scroll up, at the top of the list, and whenever selecting starts or stops.
import { useEventListener } from '@vueuse/core'
import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue'

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
