import { computed } from 'vue'

import { api, useQuery } from '@/api'
import type { InboxCategory, InboxTab } from '@/apps/mail/composables/useInboxTabs'
import { userStore } from '@/apps/mail/stores/user'
import { useScreenSize } from '@/apps/mail/utils/composables'

// How many of a category's newest threads a card names the senders of.
const READ = 20
const OTHERS: InboxCategory[] = ['updates', 'forums', 'promotions', 'social']

/** A category other than Primary, as a phone's card names it. */
export interface CategoryCard {
  tab: InboxTab
  /** When its newest mail came. */
  latest?: string
  /** Who its newest mail is from, newest first, each once. */
  senders: string[]
}

/**
 * The categories other than Primary that have a tab, each with its newest mail, the category with
 * the newest mail first: an account's Inbox (`'account'`), or every account's at once
 * (`'unified'`), or none (`false`). A phone draws them as cards over Primary (CategoryCards),
 * naming who wrote; a desktop only orders its tabs by them (`byLatestMail`), and so reads each
 * category's newest thread alone. `ready` once every category's mail has come, so the cards land
 * at once, in their order, rather than one by one.
 */
export const useCategoryCards = (
  where: () => 'account' | 'unified' | false,
  tabs: () => InboxTab[],
) => {
  const store = userStore()
  const { isMobile } = useScreenSize()
  const limit = () => (isMobile.value ? READ : 1)
  const shown = (category: InboxCategory) => !!where() && tabs().some((tab) => tab.id === category)

  const queries = OTHERS.map((category) => ({
    category,
    account: useQuery(api.mail.threads.list, () =>
      shown(category) && where() === 'account'
        ? {
            account: store.accountId,
            mailbox: store.mailboxIds.inbox,
            limit: limit(),
            start: 0,
            category,
          }
        : false,
    ),
    unified: useQuery(api.mail.unified.threads, () =>
      shown(category) && where() === 'unified'
        ? { folder: 'inbox', limit: limit(), start: 0, category }
        : false,
    ),
  }))

  const ready = computed(
    () =>
      !!where() &&
      queries.every(({ category, account, unified }) =>
        shown(category) ? !!(where() === 'unified' ? unified.data : account.data) : true,
      ),
  )

  const cards = computed<CategoryCard[]>(() =>
    queries
      .flatMap(({ category, account, unified }) => {
        const tab = tabs().find((t) => t.id === category)
        if (!tab || !where()) return []
        const threads = (where() === 'unified' ? unified.data?.rows : account.data?.rows) ?? []
        const senders = new Set(
          threads.map((thread) => thread.from_name || thread.from_email.split('@')[0]),
        )
        return [{ tab, latest: threads[0]?.received_at, senders: [...senders] }]
      })
      .sort((a, b) => newest(b) - newest(a)),
  )

  return { cards, ready }
}

const newest = (card: CategoryCard) => (card.latest ? Date.parse(card.latest) : -Infinity)

/**
 * The tabs in the order of `cards` (the newest mail first): Primary still leads and All mail still
 * ends them, and a category not in `cards` (still loading) follows the ones that are.
 */
export const byLatestMail = (tabs: InboxTab[], cards: CategoryCard[]): InboxTab[] => {
  const rank = (tab: InboxTab) => {
    if (tab.id === 'primary') return -1
    if (tab.id === 'all') return cards.length + 1
    const at = cards.findIndex((card) => card.tab.id === tab.id)
    return at < 0 ? cards.length : at
  }
  return [...tabs].sort((a, b) => rank(a) - rank(b))
}
