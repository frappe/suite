import type { Router } from 'vue-router'

import type { ComposeMailData } from '@/apps/mail/types'

/**
 * The draft a `/compose` navigation is carrying — a reply, a forward, a `mailto:` link, or a draft
 * being resumed.
 *
 * A route param can't hold it: the payload is a whole message (recipients, quoted body, attachment
 * records), and putting that in the URL would make every compose link a wall of encoded HTML that
 * breaks the moment someone shares or reloads it. So the opener leaves it here and the page picks it
 * up on mount.
 *
 * Taking it clears it, which is the point: a reload lands on an empty composer rather than silently
 * re-opening a reply the user has already dealt with, and the next plain "new mail" doesn't inherit
 * the last reply's recipients.
 */
let pending: PendingCompose = {}

/**
 * The draft, and where the page puts the caret when the opener knows: `to` for a reply whose
 * recipients were tapped to change them. Otherwise the page starts where there is still something to
 * write (see ComposeView).
 */
export type PendingCompose = { draft?: ComposeMailData; startAt?: 'to' }

export const takePendingCompose = () => {
  const taken = pending
  pending = {}
  return taken
}

/**
 * Compose, on mobile. There is no composer window there — the page is the whole of it — so every
 * opener navigates: the compose button, a reply popped out of a thread, a `mailto:` link in a
 * message, another app asking mail to write to someone.
 *
 * Passing no draft is a request for an empty one, and clears whatever a navigation that never
 * happened left behind.
 */
export const openComposePage = (
  router: Router,
  accountId: string,
  draft?: ComposeMailData,
  startAt?: PendingCompose['startAt'],
) => {
  pending = { draft, startAt }
  return router.push({ name: 'mail-compose', params: { accountId } })
}
