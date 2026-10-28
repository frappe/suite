import { beforeEach, describe, expect, it, vi } from 'vitest'

import { transport } from '@/platform/transport'

import { searchUsers, uploadMedia } from './drive'

vi.mock(import('@/platform/transport'), async (importOriginal) => ({
  ...(await importOriginal()),
  transport: { request: vi.fn() },
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
      const { publicName } = operation as Operation
      if (publicName === 'uploads.create') {
        created.push(input as Record<string, unknown>)
        return { mode: 'chunked', upload_id: 'u1' }
      }
      if (publicName === 'uploads.chunk') {
        const { offset, chunk } = input as Chunk
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
    expect(server.requests.map((request) => request.bytes)).toEqual([16 * MiB, 14 * MiB])
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
