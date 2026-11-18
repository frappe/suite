import type { RouteLocationRaw } from 'vue-router'

import type { MailRecipient } from '@/apps/mail/types'

/**
 * Mail's compose link (`/mail?compose=1&to=a,b`): how another app on a phone opens Mail's composer
 * for people, as a move into Mail. It carries addresses only: whatever else a composer needs is
 * Mail's to fill in on arrival (see `useComposeLinkArrival`). Light on purpose: following it loads
 * nothing of Mail's composer on the page it leaves.
 */
export const composeLink = (to: readonly MailRecipient[]): RouteLocationRaw => ({
  path: '/mail',
  query: { compose: '1', to: to.map(({ email }) => email).join(',') },
})
