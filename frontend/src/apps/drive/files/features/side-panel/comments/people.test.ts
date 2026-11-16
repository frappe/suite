import { beforeEach, describe, expect, it, vi } from 'vitest'

import { client } from '@/api'
import { rememberDriveLink } from '@/apps/drive'
import { createTransport, transport } from '@/platform/transport'

import { peopleWithoutAccess, searchUsers } from './people'

vi.mock('@/platform/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/transport')>()),
  transport: { request: vi.fn(async () => ({})) },
}))

const user = (name: string, full_name: string | null) => ({
  kind: 'user' as const,
  name,
  email: name,
  full_name,
  user_image: null,
})

const page = {
  rows: [user('asha@x.test', 'Asha '), { kind: 'group', name: 'Design', member_count: 2 }],
  next_cursor: '20',
}

describe('mention search', () => {
  beforeEach(() => vi.mocked(transport.request).mockReset())

  it('sends the typed text as the query and fetches one page of users only', async () => {
    vi.mocked(transport.request).mockResolvedValue(page)

    const found = await searchUsers(' as ')

    expect(found.map((u) => [u.name, u.value, u.label])).toEqual([
      ['asha@x.test', 'asha@x.test', 'Asha'],
    ])
    expect(vi.mocked(transport.request).mock.calls.map(([, input]) => input)).toEqual([{ q: 'as' }])
  })

  it('asks for the first page of everyone when nothing is typed', async () => {
    vi.mocked(transport.request).mockResolvedValue({
      rows: [user('ben@x.test', null)],
      next_cursor: null,
    })

    const found = await searchUsers('')

    expect(found[0]?.label).toBe('ben@x.test')
    expect(vi.mocked(transport.request).mock.calls.map(([, input]) => input)).toEqual([{}])
  })

  it('searches on a document with the search route', async () => {
    vi.mocked(transport.request).mockResolvedValue({ rows: [], next_cursor: null })

    await searchUsers('as', 'doc-1')

    const [[operation, input]] = vi.mocked(transport.request).mock.calls
    expect([operation.path, input]).toEqual(['people', { q: 'as', node: 'doc-1' }])
  })
})

describe('the people a comment newly names', () => {
  beforeEach(() => vi.mocked(transport.request).mockReset())

  it('asks once about everyone, and answers the people who cannot open the document', async () => {
    vi.mocked(transport.request).mockResolvedValue([
      { ...user('ann@x.test', 'Ann'), has_access: true },
      { ...user('ben@x.test', 'Ben'), has_access: false },
      { ...user('cam@x.test', 'Cam'), has_access: false, is_blocked: true },
    ])

    const locked = await peopleWithoutAccess('doc-1', ['ann@x.test', 'ben@x.test', 'cam@x.test'])

    expect(locked.map((person) => [person.name, person.is_blocked])).toEqual([
      ['ben@x.test', undefined],
      ['cam@x.test', true],
    ])
    expect(
      vi.mocked(transport.request).mock.calls.map(([operation, input]) => [operation.path, input]),
    ).toEqual([
      ['people/lookup', { node: 'doc-1', users: ['ann@x.test', 'ben@x.test', 'cam@x.test'] }],
    ])
  })

  it('counts nobody when the lookup fails, so the comment still posts', async () => {
    const failed = vi.spyOn(client, 'query').mockRejectedValueOnce(new Error('offline'))

    await expect(peopleWithoutAccess('doc-1', ['ann@x.test'])).resolves.toEqual([])
    expect(failed).toHaveBeenCalledOnce()
  })
})

describe('a person whose only access to a document is a share link', () => {
  const CODE = 'SharedDocumentLink0001'
  const ben = { ...user('ben@x.test', 'Ben'), has_access: false }

  // Plays both people routes: a question about the shared document needs its link, as Comment does
  function peopleServer() {
    const sent: Array<string | null> = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const link = new Headers(init?.headers).get('X-Drive-Links')
      sent.push(link)
      const asksAboutDocument = String(url).includes('node=')
      if (asksAboutDocument && link !== CODE) {
        return new Response(JSON.stringify({ errors: [{ type: 'DriveForbidden' }] }), {
          status: 403,
        })
      }
      const data = String(url).includes('people/lookup')
        ? [ben]
        : { rows: [ben], next_cursor: null }
      return new Response(JSON.stringify({ data }))
    })
    vi.mocked(transport.request).mockImplementation(createTransport({ fetch: fetcher }).request)
    return sent
  }

  beforeEach(() => {
    vi.mocked(transport.request).mockReset()
    rememberDriveLink(CODE, 'shared-doc')
  })

  it('finds people to mention', async () => {
    peopleServer()

    const found = await searchUsers('', 'shared-doc')

    expect(found.map((person) => person.name)).toEqual(['ben@x.test'])
  })

  it('learns who a comment names without access', async () => {
    peopleServer()

    const locked = await peopleWithoutAccess('shared-doc', ['ben@x.test'])

    expect(locked.map((person) => person.name)).toEqual(['ben@x.test'])
  })

  it('sends the link only with a question about that document', async () => {
    const sent = peopleServer()

    await searchUsers('ben')
    await searchUsers('ben', 'another-doc').catch(() => [])

    expect(sent).toEqual([null, null])
  })
})
