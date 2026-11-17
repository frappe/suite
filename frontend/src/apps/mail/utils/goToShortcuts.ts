import type { RouteLocationRaw } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'

/**
 * `g` then a letter: a jump to one of the open account's folders, or its Outbox. Every jump stays
 * in that account; none crosses to another account or to All Inboxes.
 *
 * The account is read at the press, not when the layout mounted: the layout stays mounted while
 * another account is picked, so a value taken once kept sending `g i` to the first account opened.
 */
export function useGoToShortcuts(): (key: string) => RouteLocationRaw | undefined {
  const store = userStore()
  const folder = (mailbox: string) => ({
    name: 'mail-mailbox',
    params: { accountId: store.accountId, mailbox },
  })
  const destinations = {
    o: () => ({ name: 'mail-outbox', params: { accountId: store.accountId } }),
    i: () => folder(store.mailboxIds.inbox),
    f: () => folder('starred'),
    s: () => folder(store.mailboxIds.sent),
    d: () => folder(store.mailboxIds.drafts),
    j: () => folder(store.mailboxIds.junk),
    e: () => folder(store.mailboxIds.archive),
    t: () => folder(store.mailboxIds.trash),
  } satisfies Record<string, () => RouteLocationRaw>
  return (key) => Object.entries(destinations).find(([letter]) => letter === key)?.[1]()
}
