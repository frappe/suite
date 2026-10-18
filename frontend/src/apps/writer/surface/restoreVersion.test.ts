import type { RestoreResult } from '@suite/collab-client'
import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab'
import { encodeAnchor, readAnchor } from '@/apps/writer/collab/anchors'
import { writerSchema } from '@/apps/writer/schema'

import { restoreVersion } from './restoreVersion'

const schema = getSchema(writerSchema())

// A room that runs the restore's edit and answers `result`
function fakeRoom(result: RestoreResult) {
  return {
    doc: new Y.Doc(),
    lineage: 'one',
    flush: vi.fn(() => Promise.resolve()),
    committedCovers: () => true,
    restoreVersion: vi.fn(async (_seq: number, edit: () => void) => {
      edit()
      return result
    }),
  }
}

function html(value: string) {
  return new TextEncoder().encode(value)
}

function shown(doc: Y.Doc) {
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(BODY_FIELD))
  return schema.nodeFromJSON(json).textContent
}

// A document of one paragraph, "hello world", whose text a thread on "world" holds
function documentWithThread() {
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }
  const doc = prosemirrorJSONToYDoc(schema, { type: 'doc', content: [paragraph] }, BODY_FIELD)
  const text = textOf(doc)
  const anchor = encodeAnchor(
    Y.createRelativePositionFromTypeIndex(text, 6, 0),
    Y.createRelativePositionFromTypeIndex(text, 11, -1),
    'world',
  )
  return { doc, threads: [{ name: 't1', anchor }] }
}

function textOf(doc: Y.Doc) {
  const paragraph = doc.getXmlFragment(BODY_FIELD).get(0) as Y.XmlElement
  return paragraph.get(0) as Y.XmlText
}

async function yjsVersion(doc: Y.Doc) {
  const raw = new Response(new Uint8Array(Y.encodeStateAsUpdate(doc))).body!
  const zipped = new Uint8Array(
    await new Response(raw.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  )
  const state = btoa(String.fromCharCode(...zipped))
  return encode({ schema: 'writer-document/2', codec: 'yjs1', lineage: 'one', state })
}

function encode(value: object) {
  return new TextEncoder().encode(JSON.stringify(value))
}

// The words an anchor covers in the document now
function covered(doc: Y.Doc, anchor: string) {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return null
  }

  const from = Y.createAbsolutePositionFromRelativePosition(read.start, doc)!
  const to = Y.createAbsolutePositionFromRelativePosition(read.end, doc)!
  return (from.type as Y.XmlText).toString().slice(from.index, to.index)
}

// A restore after "world" was deleted, in a room whose server holds what it is told to
async function restoreLostWorld(result: RestoreResult, isSaved: boolean) {
  const { doc, threads } = documentWithThread()
  const bytes = await yjsVersion(doc)
  textOf(doc).delete(5, 6)
  const room = { ...fakeRoom(result), doc, committedCovers: () => isSaved }
  const notice = await restoreVersion(room, 4, bytes, threads)
  return { doc, notice }
}

describe('restoreVersion', () => {
  it('saves first, then makes the document the version', async () => {
    const room = fakeRoom({ outcome: 'landed' })

    const notice = await restoreVersion(room, 4, html('<p>back then</p>'), [])

    expect(notice).toEqual({ isRestored: true, message: 'Version restored', anchors: {} })
    expect([
      room.flush.mock.invocationCallOrder[0] < room.restoreVersion.mock.invocationCallOrder[0],
      room.restoreVersion.mock.calls[0][0],
      shown(room.doc),
    ]).toEqual([true, 4, 'back then'])
  })

  it('gives threads new anchors on the text a landed restore brought back', async () => {
    const { doc, notice } = await restoreLostWorld({ outcome: 'landed' }, true)

    expect([Object.keys(notice.anchors), covered(doc, notice.anchors.t1)]).toEqual([
      ['t1'],
      'world',
    ])
  })

  it.each([
    ['a refused restore', { outcome: 'refused' }, true],
    ['text the server does not hold', { outcome: 'landed' }, false],
  ] as [string, RestoreResult, boolean][])(
    'moves no thread for %s',
    async (_case, result, isSaved) => {
      const { notice } = await restoreLostWorld(result, isSaved)

      expect(notice.anchors).toEqual({})
    },
  )

  it('never begins a restore of bytes it cannot read', async () => {
    const room = fakeRoom({ outcome: 'landed' })

    const notice = await restoreVersion(room, 4, new Uint8Array([0xff, 0xfe]), [])

    expect([notice.isRestored, notice.message, room.restoreVersion.mock.calls.length]).toEqual([
      false,
      "This version can't be restored.",
      0,
    ])
  })

  it.each([
    [{ outcome: 'unchanged' }, true, 'The document already matches this version.'],
    [{ outcome: 'unsent' }, false, 'Your changes are still saving. Try again in a moment.'],
    [
      { outcome: 'refused', refusal: 'restore_recent', retryS: 42 },
      false,
      'A restore just ran. Try again in 42 seconds.',
    ],
    [
      { outcome: 'refused', refusal: 'restoring' },
      false,
      'Someone else is restoring a version. Try again once it is done.',
    ],
    [
      { outcome: 'refused', refusal: 'milestone_failed' },
      false,
      "The document as it is now couldn't be kept as a version first, so nothing was restored.",
    ],
    [{ outcome: 'refused' }, false, 'The version was not restored.'],
  ] as [RestoreResult, boolean, string][])(
    'tells the person how %o went',
    async (result, isRestored, message) => {
      const notice = await restoreVersion(fakeRoom(result), 4, html('<p>x</p>'), [])

      expect(notice).toEqual({ isRestored, message, anchors: {} })
    },
  )
})
