import { useStorage } from '@vueuse/core'

import type { MailRecentSearch } from '@/apps/mail/components/CommandPalette/types'
import { getSessionUser } from '@/utils/session'

// The searches the reader ran last, offered before anything is typed: by the palette, and by a
// phone's search screen. Five, since there they are the whole of an empty page; in the browser, as a
// convenience of the device someone searches from, and not worth a round trip on every opening.
// Under the user's name, since a browser is shared more often than a search is: what one person
// looked for is not the next person's to see.
const STORAGE_KEY = 'mail-recent-searches'
const KEPT = 5

// A remembered search is known by what it asked, the words and the filters, which is what makes a
// repeat a repeat. Not by `at`: two searches run in the same millisecond share one.
export const searchKey = (entry: Pick<MailRecentSearch, 'text' | 'filters'>) =>
  `${entry.text}\u0000${JSON.stringify(entry.filters)}`

export const useRecentMailSearches = () => {
  const recentSearches = useStorage<MailRecentSearch[]>(
    `${STORAGE_KEY}:${getSessionUser() ?? 'guest'}`,
    [],
  )

  /** Keeps a search as the most recent, dropping an earlier copy of the same one. */
  const rememberSearch = (
    search: Pick<MailRecentSearch, 'text' | 'filters' | 'label' | 'account'>,
  ) => {
    if (!search.text && !Object.keys(search.filters).length) return
    const key = searchKey(search)
    recentSearches.value = [
      { ...search, resultType: 'mail-recent-search' as const, at: Date.now() },
      ...recentSearches.value.filter((entry) => searchKey(entry) !== key),
    ].slice(0, KEPT)
  }

  const forgetSearch = (search: MailRecentSearch) => {
    const key = searchKey(search)
    recentSearches.value = recentSearches.value.filter((kept) => searchKey(kept) !== key)
  }

  const clearRecentSearches = () => (recentSearches.value = [])

  return { recentSearches, rememberSearch, forgetSearch, clearRecentSearches, searchKey }
}
