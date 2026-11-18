import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useComposeMail } from '@/apps/mail/utils/composables'

/**
 * Opens the composer a compose link (see utils/composeLink.ts) asks for, as the page arrives on it, and takes the link off the
 * URL so a reload or Back does not open it again. Taken off first: on a phone the composer is a
 * page, and taking it off after would cancel the move to that page. Call it in Mail's layout setup.
 */
export function useComposeLinkArrival(): void {
  const route = useRoute()
  const router = useRouter()
  const { requestCompose } = useComposeMail()
  watch(
    () => route.query.compose,
    async (compose) => {
      if (!compose) return
      const to = String(route.query.to || '')
        .split(',')
        .filter(Boolean)
      const { compose: _compose, to: _to, ...query } = route.query
      await router.replace({ query })
      requestCompose({ to: to.map((email) => ({ email })) })
    },
    { immediate: true },
  )
}
