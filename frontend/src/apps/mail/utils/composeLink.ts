import type { RouteLocationRaw } from 'vue-router'

import type { MailRecipient } from '@/apps/mail/types'

/**
 * Mail's compose link (`/mail?compose=1&to=a,b`): how another app on a phone hands people to Mail's
 * composer, as a move into Mail. It carries addresses only: whatever else a composer needs is
 * Mail's to fill in on arrival (Mail's layout reads it). Light on purpose: following it loads
 * nothing of Mail's composer on the page it leaves.
 */
export const composeLink = (to: readonly MailRecipient[]): RouteLocationRaw => ({
  path: '/mail',
  query: { compose: '1', to: to.map(({ email }) => email).join(',') },
})
