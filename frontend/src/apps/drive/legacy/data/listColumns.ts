import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'

// Grid tracks shared by the list view and its loading skeleton, so the
// placeholder rows land exactly where the real ones will.
export function useListColumns() {
  const route = useRoute()
  const isDesktop = useMediaQuery('(min-width: 640px)')
  return computed(() =>
    isDesktop.value
      ? [
          '16px',
          'minmax(0,1fr)',
          '10%',
          '15%',
          route.name === 'drive-Attachments' ? '25%' : '8%',
          '5%',
        ]
      : ['16px', 'minmax(0,1fr)', '7rem', '32px']
  )
}
