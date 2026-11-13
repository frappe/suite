import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import { searchUsers, type MentionUser } from './people'
import { createUsers, rankMentionsFor, useUsers } from './useUsers'

vi.mock('./people', () => ({ searchUsers: vi.fn() }))
vi.mock('@/api', () => ({ client: { query: vi.fn() }, api: { suite: { people: { list: {} } } } }))
vi.mock('@/platform/session', () => ({ useSession: () => ({ user: { value: 'me@x.test' } }) }))

function person(name: string, full_name = name.toUpperCase()): MentionUser {
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
  const asked: {
    query: string
    node?: string | null
    answer: (people: MentionUser[]) => void
    fail: () => void
  }[] = []
  function search(query: string, node?: string | null) {
    return new Promise<MentionUser[]>((resolve, reject) => {
      asked.push({ query, node, answer: resolve, fail: () => reject(new Error('offline')) })
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

  it('the menu names the query its people answer, and not one still being asked', async () => {
    vi.useFakeTimers()
    const server = heldServer()
    const people = createUsers(server.search)
    const before = people.answeredQuery.value
    people.start()
    server.asked[0].answer([person('ann'), person('bob')])
    await vi.advanceTimersByTimeAsync(0)
    const firstPage = people.answeredQuery.value

    people.searchMentions('b')
    await vi.advanceTimersByTimeAsync(250)
    const asking = people.answeredQuery.value
    server.asked[1].answer([person('bob')])
    await vi.advanceTimersByTimeAsync(0)
    const answered = people.answeredQuery.value
    people.searchMentions('')

    expect([before, firstPage, asking, answered, people.answeredQuery.value]).toEqual([
      null,
      '',
      '',
      'b',
      '',
    ])
  })

  it('a failed search answers its query with no one, so the menu stops waiting', async () => {
    vi.useFakeTimers()
    const server = heldServer()
    const people = createUsers(server.search)
    people.start()
    server.asked[0].answer([person('ann')])
    people.searchMentions('z')
    await vi.advanceTimersByTimeAsync(250)

    server.asked[1].fail()
    await vi.advanceTimersByTimeAsync(0)

    expect([people.answeredQuery.value, people.users.value]).toEqual(['z', []])
  })

  it('a query whose search failed is asked again the next time it is typed', async () => {
    vi.useFakeTimers()
    const server = heldServer()
    const people = createUsers(server.search)
    people.start()
    server.asked[0].fail()
    await vi.advanceTimersByTimeAsync(0)
    people.searchMentions('')
    await vi.advanceTimersByTimeAsync(250)
    server.asked[1].answer([person('ann')])
    people.searchMentions('z')
    await vi.advanceTimersByTimeAsync(250)
    server.asked[2].fail()
    await vi.advanceTimersByTimeAsync(0)
    people.searchMentions('z')
    await vi.advanceTimersByTimeAsync(250)

    const queries = server.asked.map((asked) => asked.query)
    expect(queries).toEqual(['', '', 'z', 'z'])
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

  it("asks for a document's people, and drops another document's when it opens", async () => {
    vi.useFakeTimers()
    const server = heldServer()
    const people = createUsers(server.search)
    people.rankFor('doc-1')
    people.start()
    server.asked[0].answer([person('ann')])
    await vi.advanceTimersByTimeAsync(0)
    const first = people.users.value.map((user) => user.name)

    people.rankFor('doc-2')
    const switched = people.users.value
    people.start()
    people.searchMentions('')

    expect([first, switched, server.asked.map((asked) => [asked.query, asked.node])]).toEqual([
      ['ann'],
      [],
      [
        ['', 'doc-1'],
        ['', 'doc-2'],
      ],
    ])
  })

  it("a document opened after another offers its own people, not the other's", async () => {
    vi.mocked(searchUsers).mockImplementation(async (_query, node) =>
      node === 'doc-a'
        ? [{ ...person('ann'), has_access: false }]
        : [{ ...person('bob'), has_access: true }],
    )
    rankMentionsFor('doc-a')
    const { users } = useUsers()
    await vi.waitFor(() => expect(users.value.map((user) => user.name)).toEqual(['ann']))

    rankMentionsFor('doc-b')
    // A menu opened now waits for this document's answer; it never shows the last one's markers
    const whileAsking = users.value
    await vi.waitFor(() => expect(users.value.map((user) => user.name)).toEqual(['bob']))

    expect(whileAsking).toEqual([])
    expect(vi.mocked(searchUsers).mock.calls).toEqual([
      ['', 'doc-a'],
      ['', 'doc-b'],
    ])
  })
})
