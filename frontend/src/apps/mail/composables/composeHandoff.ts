import type { Router } from 'vue-router'

import { writesSettled } from '@/api'
import type { ComposeMailData } from '@/apps/mail/types'
import { loadPage, pageLoadNeededFor } from '@/platform/pwa'

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
let pending: ComposeMailData | undefined

/*
 * One move loads the page afresh, which takes what is in memory with it: an iPhone's browser reloads
 * on going from another app into Mail (see `pageLoadNeededFor`), and another app writing to someone
 * is exactly that move. That move is made as a page load from the start (see `openComposePage`), and
 * its draft waits in sessionStorage for the page that loads.
 */
const STORAGE_KEY = 'suite.mail.pending-compose'

const isDraft = (value: unknown): value is ComposeMailData =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const store = (draft?: ComposeMailData) => {
  try {
    if (draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* No storage, or a draft too big for it: the page opens empty, as it did before this copy. */
  }
}

const takeStored = (): ComposeMailData | undefined => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : undefined
    return isDraft(stored) ? stored : undefined
  } catch {
    return undefined
  }
}

export const takePendingCompose = () => {
  const draft = pending ?? takeStored()
  pending = undefined
  store(undefined)
  return draft
}

/**
 * Compose, on mobile. There is no composer window there — the page is the whole of it — so every
 * opener navigates: the compose button, a reply popped out of a thread, a `mailto:` link in a
 * message, another app asking mail to write to someone.
 *
 * Passing no draft is a request for an empty one, and clears whatever a navigation that never
 * happened left behind.
 *
 * A move that would load the page afresh anyway is made as a page load at once. Left to the router,
 * it mounted the compose page on the page being left before the reload; that composer saved the
 * draft, and the page that loaded saved it again — two drafts for one press.
 */
export const openComposePage = async (
  router: Router,
  accountId: string,
  draft?: ComposeMailData,
): Promise<void> => {
  // By path rather than name: from another app, Mail's routes are not registered until the first
  // visit to /mail, which this may be.
  const path = `/mail/account/${encodeURIComponent(accountId)}/compose`
  if (pageLoadNeededFor(path)) {
    pending = undefined
    store(draft)
    // What the page being left is still saving lands first, as it does before the router's reload.
    await writesSettled()
    loadPage(path)
    return
  }
  pending = draft
  store(undefined)
  await router.push(path)
}
