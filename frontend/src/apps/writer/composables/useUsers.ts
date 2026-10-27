import { shallowRef, type ShallowRef } from 'vue'

import { searchUsers, type WriterUser } from '@/apps/writer/drive'
import { useSession } from '@/platform/session'

const SEARCH_DELAY_MS = 250

type Search = (query: string) => Promise<WriterUser[]>

// Everyone seen so far, for avatars and names on mentions, comments and carets
function createDirectory() {
  const known = new Map<string, WriterUser>()
  /** Bumped when people arrive, so names read from `known` update. */
  const version = shallowRef(0)

  function remember(people: WriterUser[]) {
    for (const person of people) {
      known.set(person.name, person)
    }

    version.value++
  }

  function getUser(name: string) {
    void version.value
    return known.get(name)
  }

  return { remember, getUser }
}

// Names people by user id, looking each one up once
function createNames(search: Search, directory: ReturnType<typeof createDirectory>) {
  const lookups = new Map<string, Promise<void>>()

  /** A failed lookup leaves the user id as the name. */
  async function fetchPerson(user: string) {
    const found = await search(user).catch(() => null)
    if (found) {
      directory.remember(found)
    }
  }

  function lookUp(user: string): Promise<void> {
    let lookup = lookups.get(user)
    if (!lookup) {
      lookup = fetchPerson(user)
      lookups.set(user, lookup)
    }

    return lookup
  }

  /** A person's full name; their user id until the lookup answers. */
  function fullName(user: string): string {
    const found = directory.getUser(user)
    if (!found) {
      void lookUp(user)
    }

    return found?.full_name || user
  }

  return { lookUp, fullName }
}

interface MenuState {
  users: ShallowRef<WriterUser[]>
  /** The query `users` answers; null before the first answer. */
  answeredQuery: ShallowRef<string | null>
  /** The answer to the empty query, shown the moment `@` is typed. */
  firstPage: WriterUser[]
  latest: number
}

/** False when the search failed. */
async function runMenuSearch(
  menu: MenuState,
  search: Search,
  remember: (people: WriterUser[]) => void,
  query: string,
) {
  const id = ++menu.latest
  const found = await search(query).catch(() => null)
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

// The people the `@` menu offers, from the latest answer the server gave
function createMenu(search: Search, remember: (people: WriterUser[]) => void) {
  const menu: MenuState = {
    users: shallowRef<WriterUser[]>([]),
    answeredQuery: shallowRef<string | null>(null),
    firstPage: [],
    latest: 0,
  }

  return {
    users: menu.users,
    answeredQuery: menu.answeredQuery,
    run: (query: string) => runMenuSearch(menu, search, remember, query),
    showFirstPage: () => showMenuFirstPage(menu),
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

  return { ask, searchMentions }
}

export function createUsers(search: Search = searchUsers) {
  const directory = createDirectory()
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

  const names = createNames(search, directory)
  return {
    ...directory,
    ...names,
    users: menu.users,
    answeredQuery: menu.answeredQuery,
    searchMentions: mentionSearch.searchMentions,
    start,
  }
}

const people = createUsers()

export const { searchMentions, lookUp, fullName } = people

/**
 * The people for mentions and avatars. The first page loads once per page
 * load; `searchMentions` narrows the menu as the user types after `@`.
 * Components that use `$user(...)` in templates alias `getUser` to `$user`.
 */
export function useUsers() {
  if (useSession().user.value) {
    people.start()
  }

  return { users: people.users, answeredQuery: people.answeredQuery, getUser: people.getUser }
}
