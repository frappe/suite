import { shallowRef, type ShallowRef } from 'vue'

import { createPeople, people as shared } from '@/platform/collab/names'
import { useSession } from '@/platform/session'

import { searchUsers, type MentionUser } from './people'

const SEARCH_DELAY_MS = 250

type Search = (query: string, node?: string | null) => Promise<MentionUser[]>

interface MenuState {
  users: ShallowRef<MentionUser[]>
  /** The query `users` answers; null before the first answer. */
  answeredQuery: ShallowRef<string | null>
  /** The answer to the empty query, shown the moment `@` is typed. */
  firstPage: MentionUser[]
  latest: number
  /** The document the menu ranks people for. */
  node: string | null
}

/** False when the search failed. */
async function runMenuSearch(
  menu: MenuState,
  search: Search,
  remember: (people: MentionUser[]) => void,
  query: string,
) {
  const id = ++menu.latest
  const found = await search(query, menu.node).catch(() => null)
  const isFound = found !== null
  // An answer older than the latest leaves the menu as it was
  if (id !== menu.latest) {
    return isFound
  }

  // A failed search answers with no one, so the menu stops waiting on it
  menu.users.value = found ?? []
  menu.answeredQuery.value = query
  if (found) {
    remember(found)
    if (!query.trim()) {
      menu.firstPage = found
    }
  }

  return isFound
}

/** Shows the first page again without asking, once it has loaded. */
function showMenuFirstPage(menu: MenuState) {
  if (!menu.firstPage.length) {
    return false
  }

  menu.latest++
  menu.users.value = menu.firstPage
  menu.answeredQuery.value = ''
  return true
}

/** Ranks for another document from now on; true when it changed, which drops the old answers. */
function rankMenuFor(menu: MenuState, node: string) {
  if (node === menu.node) {
    return false
  }

  menu.node = node
  menu.latest++
  menu.firstPage = []
  menu.users.value = []
  menu.answeredQuery.value = null
  return true
}

// The people the `@` menu offers, from the latest answer the server gave
function createMenu(search: Search, remember: (people: MentionUser[]) => void) {
  const menu: MenuState = {
    users: shallowRef<MentionUser[]>([]),
    answeredQuery: shallowRef<string | null>(null),
    firstPage: [],
    latest: 0,
    node: null,
  }

  return {
    users: menu.users,
    answeredQuery: menu.answeredQuery,
    run: (query: string) => runMenuSearch(menu, search, remember, query),
    showFirstPage: () => showMenuFirstPage(menu),
    rankFor: (node: string) => rankMenuFor(menu, node),
  }
}

// Narrows the menu as the user types after `@`, once the typing pauses
function createMentionSearch(menu: ReturnType<typeof createMenu>) {
  let lastQuery: string | null = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  // A failed search does not count as asked, so the same query asks again
  async function ask(query: string) {
    const isFound = await menu.run(query)
    if (!isFound && lastQuery === query) {
      lastQuery = null
    }
  }

  function searchMentions(query: string): void {
    if (query === lastQuery) {
      return
    }

    lastQuery = query
    clearTimeout(timer)
    if (!query.trim() && menu.showFirstPage()) {
      return
    }

    timer = setTimeout(() => void ask(query), SEARCH_DELAY_MS)
  }

  function forget() {
    lastQuery = ''
    clearTimeout(timer)
  }

  return { ask, searchMentions, forget }
}

export function createUsers(search: Search = searchUsers, directory = createPeople(search)) {
  const menu = createMenu(search, directory.remember)
  const mentionSearch = createMentionSearch(menu)
  let isStarted = false

  /** Loads the first page once. */
  function start() {
    if (!isStarted) {
      isStarted = true
      void mentionSearch.ask('')
    }
  }

  /** Ranks the menu for `node`; another node's menu loads its first page again. */
  function rankFor(node: string) {
    if (menu.rankFor(node)) {
      mentionSearch.forget()
      isStarted = false
    }
  }

  return {
    ...directory,
    users: menu.users,
    answeredQuery: menu.answeredQuery,
    searchMentions: mentionSearch.searchMentions,
    start,
    rankFor,
  }
}

// Shares one directory with the names peers go by, so a person is looked up once
const people = createUsers(searchUsers, shared)

export const { searchMentions, lookUp, fullName } = people

/**
 * Ranks the `@` menu for the document `node` and, for a signed-in user, loads
 * its first page. Whatever opens a document calls it, before anyone can type
 * `@` there.
 */
export function rankMentionsFor(node: string): void {
  people.rankFor(node)
  if (useSession().user.value) {
    people.start()
  }
}

/**
 * The people for mentions and avatars. `rankMentionsFor` loads the first page
 * once per document; `searchMentions` narrows the menu as the user types after `@`.
 * Components that use `$user(...)` in templates alias `getUser` to `$user`.
 */
export function useUsers() {
  return { users: people.users, answeredQuery: people.answeredQuery, getUser: people.getUser }
}
