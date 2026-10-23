// A row that scrolls sideways fades its cut-off end, so a clipped chip or tab reads as "more this
// way" rather than broken. The fade shows only while there is more to scroll to.
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { computed, ref } from 'vue'

export const useOverflowFade = () => {
  const scroller = ref<HTMLElement>()
  const more = ref(false)
  const check = () => {
    const el = scroller.value
    more.value = !!el && el.scrollWidth - el.scrollLeft - el.clientWidth > 1
  }
  useResizeObserver(scroller, check)
  useEventListener(scroller, 'scroll', check, { passive: true })
  const fade = computed(() =>
    more.value ? '[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]' : '',
  )
  return { scroller, fade }
}
