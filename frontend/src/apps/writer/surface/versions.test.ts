import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Doc, encodeStateAsUpdate, XmlElement, XmlText } from 'yjs'

import { client } from '@/api'
import type { DocumentSession } from '@/apps/drive'
import { BODY_FIELD } from '@/apps/writer/collab'

import { writerSchema } from '../schema'
import { convertedVersion, readVersion, storedVersionHTML } from './versions'

const schema = getSchema(writerSchema())

function encode(value: string | object) {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }

  return new TextEncoder().encode(JSON.stringify(value))
}

const document = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship the ' },
        { type: 'text', text: 'first', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' cut.' },
      ],
    },
  ],
}

// A version the old editor saved while collaborating, its Yjs newer than its HTML
function oldCollabVersion(ydoc: Doc, html = '<p>Old</p>') {
  const content = btoa(String.fromCharCode(...encodeStateAsUpdate(ydoc)))
  return { schema: 'writer-document/1', content, html, collab: 1 }
}

async function gzipBase64(bytes: Uint8Array) {
  const raw = new Response(new Uint8Array(bytes)).body!
  const stream = raw.pipeThrough(new CompressionStream('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  const zipped = new Uint8Array(buffer)
  return btoa(String.fromCharCode(...zipped))
}

async function collabVersion(firstTabLabel?: string) {
  const ydoc = prosemirrorJSONToYDoc(schema, document, 'default')
  if (firstTabLabel) {
    ydoc.getMap('meta').set('firstTabLabel', firstTabLabel)
  }

  return stateVersion(ydoc)
}

async function stateVersion(ydoc: Doc) {
  const update = encodeStateAsUpdate(ydoc)
  const state = await gzipBase64(update)
  return {
    schema: 'writer-document/2',
    codec: 'yjs1',
    lineage: 'lineage-1',
    through_rev: 7,
    chain: 'chain-7',
    state,
    html: null,
    media: [],
  }
}

describe('readVersion', () => {
  it('shows migrated history as the HTML it stored', async () => {
    expect(await readVersion(encode('<h2>Plan</h2><p>Ship it.</p>'))).toEqual({
      content: '<h2>Plan</h2><p>Ship it.</p>',
      firstTabLabel: null,
    })
  })

  it('shows a writer-document/1 version as its HTML', async () => {
    const version = {
      schema: 'writer-document/1',
      content: 'AAA=',
      html: '<p>Saved</p>',
      collab: 0,
    }

    expect(await readVersion(encode(version))).toEqual({
      content: '<p>Saved</p>',
      firstTabLabel: null,
    })
  })

  it('shows a collaborative writer-document/1 version as its Yjs text, not its out-of-date HTML', async () => {
    const version = oldCollabVersion(prosemirrorJSONToYDoc(schema, document, 'default'))
    const shown = await readVersion(encode(version))

    expect(typeof shown.content).toBe('object')
    expect(schema.nodeFromJSON(shown.content).eq(schema.nodeFromJSON(document))).toBe(true)
    expect(shown.firstTabLabel).toBeNull()
  })

  it('shows a collaborative writer-document/1 version as its HTML when its Yjs shows nothing', async () => {
    const unplaceable = new Doc()
    const element = new XmlElement('nonsense')
    element.insert(0, [new XmlText('Lost')])
    unplaceable.getXmlFragment(BODY_FIELD).insert(0, [element])
    const blank = new Doc()
    blank.getXmlFragment(BODY_FIELD).insert(0, [new XmlElement('paragraph')])

    for (const [name, version] of [
      ['unreadable', { ...oldCollabVersion(new Doc()), content: btoa('\xff\xff\xff') }],
      ['empty', oldCollabVersion(blank)],
      ['unplaceable', oldCollabVersion(unplaceable)],
    ] as const) {
      expect(await readVersion(encode(version)), name).toEqual({
        content: '<p>Old</p>',
        firstTabLabel: null,
      })
    }
  })

  it('shows a writer-document/2 version as the document its state holds', async () => {
    const version = await collabVersion()
    const shown = await readVersion(encode(version))

    expect(typeof shown.content).toBe('object')
    expect(schema.nodeFromJSON(shown.content).eq(schema.nodeFromJSON(document))).toBe(true)
    expect(shown.firstTabLabel).toBeNull()
  })

  it("reads a writer-document/2 version's renamed first tab", async () => {
    const version = await collabVersion('Intro')

    expect((await readVersion(encode(version))).firstTabLabel).toBe('Intro')
  })

  it('refuses a writer-document/1 version that restoring it would refuse', async () => {
    const saved = {
      schema: 'writer-document/1',
      content: 'AAA=',
      html: '<p>Saved</p>',
      collab: 0,
    }

    for (const broken of [
      { content: '' },
      { content: undefined },
      { collab: 2 },
      { collab: '1' },
    ]) {
      await expect(readVersion(encode({ ...saved, ...broken }))).rejects.toThrow(
        'This version cannot be read.',
      )
    }
  })

  it('refuses a version with an unknown schema', async () => {
    const version = {
      schema: 'writer-document/9',
      html: '<p>x</p>',
    }

    await expect(readVersion(encode(version))).rejects.toThrow('This version cannot be read.')
  })

  it('refuses a writer-document/2 version whose state is not gzip', async () => {
    const stored = await collabVersion()
    const version = {
      ...stored,
      state: btoa('not gzip'),
    }

    await expect(readVersion(encode(version))).rejects.toThrow()
  })

  it('refuses bytes that are not UTF-8', async () => {
    await expect(readVersion(new Uint8Array([0xff, 0xfe, 0x00]))).rejects.toThrow()
  })
})

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

// A version whose first tab is renamed and whose tabs are stored out of display order
async function tabbedVersion() {
  const content = [
    paragraph('first'),
    { type: 'tab', attrs: { id: 'b', label: 'Later', order: 1 }, content: [paragraph('bee')] },
    { type: 'tab', attrs: { id: 'a', label: 'Sooner', order: 0 }, content: [paragraph('ay')] },
  ]
  const ydoc = prosemirrorJSONToYDoc(schema, { type: 'doc', content }, 'default')
  ydoc.getMap('meta').set('firstTabLabel', 'Intro')
  return stateVersion(ydoc)
}

// A version holding elements of the given names, in the order given
function elementsVersion(...names: string[]) {
  const ydoc = new Doc()
  const elements = names.map((name) => {
    const element = new XmlElement(name)
    element.insert(0, [new XmlText(name)])
    return element
  })
  ydoc.getXmlFragment(BODY_FIELD).insert(0, elements)
  return stateVersion(ydoc)
}

// A version the old editor saved, holding an image of the kind only it had
function oldImageVersion() {
  const ydoc = new Doc()
  const image = new XmlElement('resizableMedia')
  image.setAttribute('src', '/files/chart.png')
  image.setAttribute('media-type', 'img')
  ydoc.getXmlFragment(BODY_FIELD).insert(0, [image])
  return stateVersion(ydoc)
}

function serving(response: () => Response) {
  return {
    versions: { contentUrl: (seq: string) => `/versions/${seq}` },
    credentials: { fetch: async () => response() },
  } as unknown as DocumentSession
}

function servingVersion(stored: object) {
  return serving(() => new Response(JSON.stringify(stored)))
}

describe('storedVersionHTML', () => {
  it('writes a version as the live document exports all its tabs, in display order', async () => {
    const session = servingVersion(await tabbedVersion())

    expect(await storedVersionHTML(session, 1, null)).toBe(
      '<div data-tab-id="first-tab" data-tab-label="Intro"><p>first</p></div>' +
        '<div data-tab-id="a" data-tab-label="Sooner" data-tab-order="0"><p>ay</p></div>' +
        '<div data-tab-id="b" data-tab-label="Later" data-tab-order="1"><p>bee</p></div>',
    )
  })

  it('keeps an image the old editor saved', async () => {
    const session = servingVersion(await oldImageVersion())

    expect(await storedVersionHTML(session, 1, null)).toContain('<img src="/files/chart.png"')
  })

  it('downloads a collaborative writer-document/1 version as its Yjs text with its old image', async () => {
    const ydoc = prosemirrorJSONToYDoc(schema, document, 'default')
    const image = new XmlElement('resizableMedia')
    image.setAttribute('src', '/files/chart.png')
    image.setAttribute('media-type', 'img')
    ydoc.getXmlFragment(BODY_FIELD).push([image])
    const session = servingVersion(oldCollabVersion(ydoc))

    const html = await storedVersionHTML(session, 1, null)

    expect(html).toContain('<p>Ship the <strong>first</strong> cut.</p>')
    expect(html).toContain('<img src="/files/chart.png"')
    expect(html).not.toContain('Old')
  })

  it("refuses a version whose content Writer can't show", async () => {
    const session = servingVersion(await elementsVersion('paragraph', 'nonsense'))

    await expect(storedVersionHTML(session, 1, null)).rejects.toThrow("can't be shown")
  })

  it("refuses a version the server won't give", async () => {
    const session = serving(() => new Response(null, { status: 500 }))

    await expect(storedVersionHTML(session, 1, null)).rejects.toThrow('HTTP 500')
  })
})

// The server's answers to each ask, in order, then "still converting" for every ask after
function converting(...answers: object[]) {
  return vi
    .spyOn(client, 'mutation')
    .mockImplementation(async () => answers.shift() ?? { pending: true })
}

const asking = { nodeId: 'n1', credentials: { context: {} } } as unknown as DocumentSession

describe('convertedVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('asks again every two seconds while the server converts, then reads its state', async () => {
    vi.useFakeTimers()
    const asked = converting({ pending: true }, { pending: true }, { state: 'AAA=' })

    const answer = convertedVersion(asking, 4)
    await vi.advanceTimersByTimeAsync(4000)

    expect([await answer, asked.mock.calls.length]).toEqual([
      { body: { lineage: '', state: new Uint8Array([0, 0]) } },
      3,
    ])
  })

  it('gives up once the server has converted for 150 seconds', async () => {
    vi.useFakeTimers()
    converting()
    let isSettled = false

    const answer = convertedVersion(asking, 4).finally(() => {
      isSettled = true
    })
    await vi.advanceTimersByTimeAsync(149_999)
    const isSettledEarly = isSettled
    await vi.advanceTimersByTimeAsync(1)

    expect([isSettledEarly, await answer]).toEqual([false, { isPending: true }])
  })
})
