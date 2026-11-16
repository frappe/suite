import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { transport } from '@/platform/transport'

import { uploadMedia } from './drive'

vi.mock(import('@/platform/transport'), async (importOriginal) => ({
  ...(await importOriginal()),
  transport: { request: vi.fn(async () => ({})) },
}))

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
