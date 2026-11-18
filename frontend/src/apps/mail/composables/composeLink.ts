import { watch } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import type { MailRecipient } from '@/apps/mail/types'
import { useComposeMail } from '@/apps/mail/utils/composables'

/**
 * Mail's compose link (`/mail?compose=1&to=a,b`): how another app on a phone opens Mail's composer
 * for people, as a move into Mail. It carries addresses only: whatever else a composer needs is
 * Mail's to fill in on arrival (see `useComposeLinkArrival`).
 */
export const composeLink = (to: readonly MailRecipient[]): RouteLocationRaw => ({
  path: '/mail',
  query: { compose: '1', to: to.map(({ email }) => email).join(',') },
})

/**
 * Opens the composer a compose link asks for, as the page arrives on it, and takes the link off the
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
