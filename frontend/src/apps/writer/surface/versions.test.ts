import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { writerSchema } from '../schema'
import { readVersion } from './versions'

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

async function collabVersion() {
  const ydoc = prosemirrorJSONToYDoc(schema, document, 'default')
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
    expect(await readVersion(encode('<h2>Plan</h2><p>Ship it.</p>'))).toBe(
      '<h2>Plan</h2><p>Ship it.</p>',
    )
  })

  it('shows a writer-document/1 version as its HTML', async () => {
    const version = {
      schema: 'writer-document/1',
      content: 'AAA=',
      html: '<p>Saved</p>',
      collab: 0,
    }

    expect(await readVersion(encode(version))).toBe('<p>Saved</p>')
  })

  it('shows a writer-document/2 version as the document its state holds', async () => {
    const version = await collabVersion()
    const shown = await readVersion(encode(version))

    expect(typeof shown).toBe('object')
    expect(schema.nodeFromJSON(shown).eq(schema.nodeFromJSON(document))).toBe(true)
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
