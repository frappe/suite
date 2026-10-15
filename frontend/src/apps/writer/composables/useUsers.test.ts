import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import type { WriterUser } from '@/apps/writer/drive'

import { createUsers } from './useUsers'

function person(name: string, full_name = name.toUpperCase()): WriterUser {
  return {
    name,
    email: name,
    full_name,
    user_image: null,
    value: name,
    label: full_name,
  }
}

// A server whose answers arrive only when the test releases them
function heldServer() {
  const asked: { query: string; answer: (people: WriterUser[]) => void; fail: () => void }[] = []
  function search(query: string) {
    return new Promise<WriterUser[]>((resolve, reject) => {
      asked.push({ query, answer: resolve, fail: () => reject(new Error('offline')) })
    })
  }

  return { asked, search }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('people for mentions and names', () => {
  it('an older answer that arrives late does not replace the newer one in the menu', async () => {
    vi.useFakeTimers()
    const server = heldServer()
    const people = createUsers(server.search)

    people.searchMentions('a')
    await vi.advanceTimersByTimeAsync(250)
    people.searchMentions('ab')
    await vi.advanceTimersByTimeAsync(250)
    server.asked[1].answer([person('abe')])
    server.asked[0].answer([person('ann'), person('abe')])
    await vi.advanceTimersByTimeAsync(0)

    expect(people.users.value.map((user) => user.name)).toEqual(['abe'])
  })

  it('an empty query shows the first page again without asking the server', async () => {
    vi.useFakeTimers()
    const server = heldServer()
    const people = createUsers(server.search)
    people.start()
    server.asked[0].answer([person('ann'), person('bob')])
    people.searchMentions('b')
    await vi.advanceTimersByTimeAsync(250)
    server.asked[1].answer([person('bob')])
    await vi.advanceTimersByTimeAsync(0)

    people.searchMentions('')
    await vi.advanceTimersByTimeAsync(250)

    expect([server.asked.length, people.users.value.map((user) => user.name)]).toEqual([
      2,
      ['ann', 'bob'],
    ])
  })

  it('a failed search keeps the menu as it was', async () => {
    vi.useFakeTimers()
    const server = heldServer()
    const people = createUsers(server.search)
    people.start()
    server.asked[0].answer([person('ann')])
    people.searchMentions('z')
    await vi.advanceTimersByTimeAsync(250)

    server.asked[1].fail()
    await vi.advanceTimersByTimeAsync(0)

    expect(people.users.value.map((user) => user.name)).toEqual(['ann'])
  })

  it('a name reads as the user id until one lookup answers, and then as the full name', async () => {
    const server = heldServer()
    const people = createUsers(server.search)
    const shown = computed(() => [people.fullName('ann'), people.getUser('ann')?.full_name])

    expect(shown.value).toEqual(['ann', undefined])
    people.fullName('ann')
    server.asked[0].answer([person('ann', 'Ann Lee')])
    await people.lookUp('ann')

    expect([shown.value, server.asked.length]).toEqual([['Ann Lee', 'Ann Lee'], 1])
  })

  it('people found by a mention search are named without a lookup', async () => {
    const server = heldServer()
    const people = createUsers(server.search)
    people.start()
    server.asked[0].answer([person('bob', 'Bob Roy')])
    await vi.waitFor(() => expect(people.users.value).toHaveLength(1))

    expect([people.fullName('bob'), server.asked.length]).toEqual(['Bob Roy', 1])
  })
})
