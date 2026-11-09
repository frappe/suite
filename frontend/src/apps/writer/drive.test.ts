import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { client } from '@/api'
import { rememberDriveLink } from '@/apps/drive'
import { createTransport, transport } from '@/platform/transport'

import { peopleWithoutAccess, searchUsers, uploadMedia } from './drive'

vi.mock(import('@/platform/transport'), async (importOriginal) => ({
  ...(await importOriginal()),
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

describe('media upload', () => {
  const MiB = 1024 * 1024
  type Operation = { publicName: string }
  type Chunk = { upload_id: string; offset: number; chunk: Blob }

  // Plays Drive's upload routes: a chunked session, chunks, and finish.
  function driveServer() {
    const requests: Array<{ name: string; bytes: number }> = []
    const created: Array<Record<string, unknown>> = []
    let received = 0
    vi.mocked(transport.request).mockImplementation(async (operation, input) => {
      const { publicName } = fromPartial<Operation>(operation)
      if (publicName === 'uploads.create') {
        created.push(fromPartial<Record<string, unknown>>(input))
        return { mode: 'chunked', upload_id: 'u1' }
      }
      if (publicName === 'uploads.chunk') {
        const { offset, chunk } = fromPartial<Chunk>(input)
        requests.push({ name: publicName, bytes: chunk.size })
        received = offset + chunk.size
        return { upload_id: 'u1', received }
      }
      if (publicName === 'uploads.finish') return { name: 'media1', title: 'clip.mp4' }
      throw new Error(`Unexpected ${publicName}`)
    })
    return { requests, created }
  }

  beforeEach(() => {
    vi.mocked(transport.request).mockReset()
  })

  it('sends a video larger than one request in chunks into the document', async () => {
    const server = driveServer()
    const video = new File([new Uint8Array(30 * MiB)], 'clip.mp4', { type: 'video/mp4' })
    const progress: number[] = []

    const uploaded = await uploadMedia('doc1', video, {
      onProgress: ({ percent }) => progress.push(percent),
    })

    expect(uploaded.file_url).toBe('/api/method/suite.writer.api.embed.get?id=media1')
    expect(server.created).toMatchObject([{ parent_node: 'doc1', size: 30 * MiB }])
    expect(server.created[0]?.filename).toMatch(/^doc1 embed \S+ -clip\.mp4$/)
    // Chunks start small and double while the link is fast.
    expect(server.requests.map((request) => request.bytes)).toEqual(
      [2, 4, 8, 16].map((n) => n * MiB),
    )
    expect(progress.at(-1)).toBe(100)
  })

  it('gives two files with the same name different titles', async () => {
    const server = driveServer()
    const picture = () => new File([new Uint8Array(10)], 'image.png', { type: 'image/png' })

    await uploadMedia('doc1', picture())
    await uploadMedia('doc1', picture())

    const [first, second] = server.created.map((input) => input.filename)
    expect(first).not.toBe(second)
  })
})
