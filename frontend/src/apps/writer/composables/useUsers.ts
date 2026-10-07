import { shallowRef } from 'vue'

import { searchUsers, type WriterUser } from '@/apps/writer/drive'
import { useSession } from '@/platform/session'

const SEARCH_DELAY_MS = 250

/** The people the `@` menu offers now. */
const users = shallowRef<WriterUser[]>([])
/** Everyone seen so far, for avatars and names on mentions and comments. */
const known = new Map<string, WriterUser>()
/** The answer to the empty query, shown the moment `@` is typed. */
let firstPage: WriterUser[] = []
let lastQuery = ''
let started = false
let latest = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function search(query: string): Promise<void> {
  const id = ++latest
  try {
    const found = await searchUsers(query)
    // A slower, older answer must not replace a newer one.
    if (id !== latest) return
    for (const user of found) known.set(user.name, user)
    if (!query.trim()) firstPage = found
    users.value = found
  } catch {
    // Mentions and avatars fall back to the raw user id.
  }
}

/** Ask the server for the people who match `query`, after the typing pauses. */
export function searchMentions(query: string): void {
  if (query === lastQuery) return
  lastQuery = query
  clearTimeout(timer)
  if (!query.trim() && firstPage.length) {
    latest++
    users.value = firstPage
    return
  }
  timer = setTimeout(() => void search(query), SEARCH_DELAY_MS)
}

/** Bumped when a looked-up person arrives, so names shown from `known` update. */
const learned = shallowRef(0)
const lookups = new Map<string, Promise<void>>()

/** Look a person up once by user id, for `fullName`. */
export function lookUp(user: string): Promise<void> {
  let lookup = lookups.get(user)
  if (!lookup) {
    lookup = searchUsers(user)
      .then((found) => {
        for (const person of found) known.set(person.name, person)
        learned.value++
      })
      .catch(() => {})
    lookups.set(user, lookup)
  }
  return lookup
}

/** A person's full name; their user id until the lookup answers. */
export function fullName(user: string): string {
  void learned.value
  const found = known.get(user)
  if (!found) void lookUp(user)
  return found?.full_name || user
}

/**
 * The people for mentions and avatars. The first page loads once per page
 * load; `searchMentions` narrows the menu as the user types after `@`.
 * Components that use `$user(...)` in templates alias `getUser` to `$user`.
 */
export function useUsers() {
  if (!started && useSession().user.value) {
    started = true
    void search('')
  }
  const getUser = (name: string) => known.get(name)
  return { users, getUser }
}
