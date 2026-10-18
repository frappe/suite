import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { BODY_FIELD } from '@/apps/writer/collab'

import { writerSchema } from '../schema'
import { readVersion, storedVersionHTML } from './versions'

const schema = getSchema(writerSchema())

function encode(value: string | object) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return new TextEncoder().encode(text)
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

async function stateVersion(ydoc: Y.Doc) {
  const update = Y.encodeStateAsUpdate(ydoc)
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
  const ydoc = new Y.Doc()
  const elements = names.map((name) => {
    const element = new Y.XmlElement(name)
    element.insert(0, [new Y.XmlText(name)])
    return element
  })
  ydoc.getXmlFragment(BODY_FIELD).insert(0, elements)
  return stateVersion(ydoc)
}

// A version the old editor saved, holding an image of the kind only it had
function oldImageVersion() {
  const ydoc = new Y.Doc()
  const image = new Y.XmlElement('resizableMedia')
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

  it("refuses a version whose content Writer can't show", async () => {
    const session = servingVersion(await elementsVersion('paragraph', 'nonsense'))

    await expect(storedVersionHTML(session, 1, null)).rejects.toThrow("can't be shown")
  })

  it("refuses a version the server won't give", async () => {
    const session = serving(() => new Response(null, { status: 500 }))

    await expect(storedVersionHTML(session, 1, null)).rejects.toThrow('HTTP 500')
  })
})
