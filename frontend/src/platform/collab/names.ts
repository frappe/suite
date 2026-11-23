import { shallowRef } from 'vue'

import { api, client } from '@/api'

export interface Person {
  name: string
  email: string
  full_name: string
  user_image: string | null
}

type FindPerson = (user: string) => Promise<Person[]>

// Everyone seen so far, for avatars and names on comments and carets. Names people by user id, looking each one up once
export function createPeople(find: FindPerson) {
  const known = new Map<string, Person>()
  /** Bumped when people arrive, so names read from `known` update. */
  const version = shallowRef(0)
  const lookups = new Map<string, Promise<void>>()

  function remember(people: Person[]) {
    for (const person of people) {
      known.set(person.name, person)
    }

    version.value++
  }

  function getUser(name: string) {
    void version.value
    return known.get(name)
  }

  /** A failed lookup leaves the user id as the name. */
  async function fetchPerson(user: string) {
    const found = await find(user).catch(() => null)
    if (found) {
      remember(found)
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
    const found = getUser(user)
    if (!found) {
      void lookUp(user)
    }

    return found?.full_name || user
  }

  return { remember, getUser, lookUp, fullName }
}

// The route pages users and groups together, so groups are dropped
async function findPerson(user: string): Promise<Person[]> {
  const page = await client.query(api.suite.people.list, { q: user.trim() })
  return page.rows.flatMap((row) =>
    row.kind === 'user'
      ? [
          {
            name: row.name,
            email: row.email,
            full_name: row.full_name ?? '',
            user_image: row.user_image,
          },
        ]
      : [],
  )
}

export const people = createPeople(findPerson)
export const { fullName, lookUp, getUser } = people
