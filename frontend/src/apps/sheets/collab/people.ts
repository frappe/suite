// Names and pictures of the people in a room, looked up once per user id.

import { shallowRef } from 'vue'

import { api, client } from '@/api'

import type { Person } from './presence'

type Search = (user: string) => Promise<Person | null>

async function searchPerson(user: string): Promise<Person | null> {
  const page = await client.query(api.suite.people.list, { q: user })
  const row = page.rows.find((r) => r.kind === 'user' && (r.name === user || r.email === user))
  if (!row || row.kind !== 'user') return null
  return { fullName: (row.full_name || row.email || user).trim(), image: row.user_image ?? '' }
}

/** `person(user)` answers at once (the user id until known); `version` bumps as names arrive. */
export function createPeople(search: Search = searchPerson) {
  const known = new Map<string, Person>()
  const asked = new Set<string>()
  const version = shallowRef(0)

  function person(user: string): Person {
    void version.value
    const found = known.get(user)
    if (found) return found
    if (!asked.has(user)) {
      asked.add(user)
      search(user)
        .then((p) => {
          if (!p) return
          known.set(user, p)
          version.value++
        })
        .catch(() => {}) // the user id stays the name
    }
    return { fullName: user, image: '' }
  }

  return { person, version }
}
