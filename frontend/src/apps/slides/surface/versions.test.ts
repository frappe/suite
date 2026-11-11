import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { writeDeck } from '@/apps/slides/collab/deck'
import { drawnSlides } from '@/apps/slides/collab/drawnDeck'

import { readVersionBody, readVersions, versionImages } from './versions'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const FRAME = { left: 10, top: 10, width: 100, height: 50 }

describe('reading a versions page', () => {
  it('names whoever took a version by full name, and by user id when Drive sends no name', () => {
    const page = readVersions({
      rows: [
        {
          seq: 2,
          kind: 'auto',
          actor: 'theo@northwind.test',
          person: { full_name: 'Theo Williams' },
        },
        { seq: 1, kind: 'named', actor: 'maya@northwind.test' },
      ],
      next_cursor: null,
    })

    expect(page.rows.map((version) => version.actor)).toEqual([
      'Theo Williams',
      'maya@northwind.test',
    ])
  })
})

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

  it('tells an old row version apart', async () => {
    const body = await readVersionBody(json({ schema: 'presentation/1', slides: [] }))

    expect(body).toEqual({ isLegacy: true })
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

    const images = versionImages(Y.encodeStateAsUpdate(doc))

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
