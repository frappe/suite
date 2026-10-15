import { shallowRef } from 'vue'

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

// The people the `@` menu offers, from the latest answer the server gave
function createMenu(search: Search, remember: (people: WriterUser[]) => void) {
  const users = shallowRef<WriterUser[]>([])
  /** The answer to the empty query, shown the moment `@` is typed. */
  let firstPage: WriterUser[] = []
  let latest = 0

  async function run(query: string) {
    const id = ++latest
    const found = await search(query).catch(() => null)
    // A failed search, or an answer older than the latest, leaves the menu as it was
    if (id !== latest || !found) {
      return
    }

    remember(found)
    users.value = found
    firstPage = query.trim() ? firstPage : found
  }

  /** Shows the first page again without asking, once it has loaded. */
  function showFirstPage() {
    if (!firstPage.length) {
      return false
    }

    latest++
    users.value = firstPage
    return true
  }

  return { users, run, showFirstPage }
}

// Narrows the menu as the user types after `@`, once the typing pauses
function createMentionSearch(menu: ReturnType<typeof createMenu>) {
  let lastQuery = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  return function searchMentions(query: string): void {
    if (query === lastQuery) {
      return
    }

    lastQuery = query
    clearTimeout(timer)
    if (!query.trim() && menu.showFirstPage()) {
      return
    }

    timer = setTimeout(() => void menu.run(query), SEARCH_DELAY_MS)
  }
}

export function createUsers(search: Search = searchUsers) {
  const directory = createDirectory()
  const menu = createMenu(search, directory.remember)
  let isStarted = false

  /** Loads the first page once. */
  function start() {
    if (!isStarted) {
      isStarted = true
      void menu.run('')
    }
  }

  const names = createNames(search, directory)
  const searchMentions = createMentionSearch(menu)
  return { ...directory, ...names, users: menu.users, searchMentions, start }
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

  return { users: people.users, getUser: people.getUser }
}
