import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { client } from '@/api'
import type { DocumentSession } from '@/apps/drive'
import { writeDeck } from '@/apps/slides/collab/deck'
import { drawnSlides } from '@/apps/slides/collab/drawnDeck'

import { convertedVersion, readVersionBody, versionImages } from './versions'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/api', () => ({
  api: { slides: { versions: { convert: 'versions.convert' } } },
  client: { mutation: vi.fn() },
}))

const FRAME = { left: 10, top: 10, width: 100, height: 50 }

// A version as the server stores one: its Yjs state gzipped, then base64, in a JSON record
async function storedVersion(doc: Y.Doc) {
  const stream = new Response(new Uint8Array(Y.encodeStateAsUpdate(doc))).body!.pipeThrough(
    new CompressionStream('gzip'),
  )
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
  const record = {
    schema: 'slides-document/2',
    codec: 'yjs1',
    lineage: 'lineage-1',
    state: btoa(String.fromCharCode(...compressed)),
    html: null,
  }
  return new TextEncoder().encode(JSON.stringify(record))
}

function json(record: unknown) {
  return new TextEncoder().encode(JSON.stringify(record))
}

describe('reading a stored version', () => {
  it('gives the Yjs state of a converted presentation', async () => {
    const doc = new Y.Doc()
    writeDeck(doc, [{ id: 'one', elements: [{ id: 'title', type: 'text', frame: FRAME }] }])

    const body = await readVersionBody(await storedVersion(doc))

    if (!('state' in body)) {
      throw new Error('Expected the Yjs state')
    }

    const read = new Y.Doc()
    Y.applyUpdate(read, body.state)
    expect(drawnSlides(read)).toEqual(drawnSlides(doc))
  })

  it('gives the slides of an old row version', async () => {
    const slides = [{ client_id: 'one', elements: '[]' }]

    const body = await readVersionBody(json({ schema: 'presentation/1', slides }))

    expect(body).toEqual({ legacySlides: slides })
  })

  it('refuses an old row version with no slides list', async () => {
    const broken = json({ schema: 'presentation/1', slides: 'x' })

    await expect(readVersionBody(broken)).rejects.toThrow('This version cannot be read.')
  })

  it('refuses a version of another app', async () => {
    const writer = json({ schema: 'writer-document/2', codec: 'yjs1', state: '' })

    await expect(readVersionBody(writer)).rejects.toThrow('This version cannot be read.')
  })
})

describe('the pictures a version shows', () => {
  it('lists each picture, poster and background picture once, and no colour or old link', () => {
    const doc = new Y.Doc()
    writeDeck(doc, [
      {
        id: 'one',
        background: 'media-bg',
        elements: [
          { id: 'photo', type: 'image', src: 'media-1', attachmentName: 'beach.png', frame: FRAME },
          { id: 'again', type: 'image', src: 'media-1', attachmentName: 'beach.png', frame: FRAME },
          { id: 'clip', type: 'video', src: 'media-2', poster: 'media-3', frame: FRAME },
          { id: 'old', type: 'image', src: '/files/old.png', frame: FRAME },
        ],
      },
      { id: 'two', background: '#ffffffFF', elements: [] },
    ])

    const images = versionImages({ state: Y.encodeStateAsUpdate(doc) })

    expect(images).toEqual(
      expect.arrayContaining([
        { id: 'media-1', alt: 'beach.png' },
        { id: 'media-2', alt: '' },
        { id: 'media-3', alt: '' },
        { id: 'media-bg', alt: '' },
      ]),
    )
    expect(images).toHaveLength(4)
  })

  it('lists the pictures of an old row version from its rows, skipping rows that do not parse', () => {
    const elements = [
      { id: 'photo', type: 'image', src: 'media-1', attachmentName: 'beach.png' },
      { id: 'clip', type: 'video', src: 'media-2', poster: 'media-3' },
      { id: 'old', type: 'image', src: '/files/old.png' },
    ]
    const legacySlides = [
      { background: 'media-bg', elements: JSON.stringify(elements) },
      { background: '#ffffffFF', elements: 'not json' },
    ]

    const images = versionImages({ legacySlides })

    expect(images).toEqual(
      expect.arrayContaining([
        { id: 'media-1', alt: 'beach.png' },
        { id: 'media-2', alt: '' },
        { id: 'media-3', alt: '' },
        { id: 'media-bg', alt: '' },
      ]),
    )
    expect(images).toHaveLength(4)
  })
})

describe('upgrading an old row version on the server', () => {
  const session = fromPartial<DocumentSession>({ nodeId: 'node-1', credentials: { context: {} } })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(client.mutation).mockReset()
  })

  it('asks again while the server is still upgrading it, then gives the upgraded state', async () => {
    vi.useFakeTimers()
    vi.mocked(client.mutation)
      .mockResolvedValueOnce({ pending: true })
      .mockResolvedValueOnce({ state: btoa('\x01\x02') })

    const converted = convertedVersion(session, 7)
    await vi.advanceTimersByTimeAsync(2000)

    await expect(converted).resolves.toEqual({ state: new Uint8Array([1, 2]) })
    expect(client.mutation).toHaveBeenCalledTimes(2)
  })

  it('stops asking after two and a half minutes and says it is still being upgraded', async () => {
    vi.useFakeTimers()
    vi.mocked(client.mutation).mockResolvedValue({ pending: true })

    const converted = convertedVersion(session, 7)
    await vi.advanceTimersByTimeAsync(150_000)

    await expect(converted).resolves.toEqual({ isPending: true })
  })

  it('gives a refusal with the reason the server names, and none when it names none', async () => {
    vi.mocked(client.mutation)
      .mockResolvedValueOnce({ reason: 'combined' })
      .mockResolvedValueOnce({})

    expect(await convertedVersion(session, 7)).toEqual({ refused: 'combined' })
    expect(await convertedVersion(session, 7)).toEqual({ refused: null })
  })
})
