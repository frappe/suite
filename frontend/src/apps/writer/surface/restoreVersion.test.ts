import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { describe, expect, it, vi } from 'vitest'
import {
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromTypeIndex,
  Doc,
  encodeStateAsUpdate,
  type XmlElement,
  type XmlText,
} from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab'
import { encodeAnchor, readAnchor } from '@/apps/writer/collab/anchors'
import { writerSchema } from '@/apps/writer/schema'
import type { RestoreResult } from '@/platform/collab'

import { restoreVersion } from './restoreVersion'
import type { ConvertedVersion } from './versions'

const schema = getSchema(writerSchema())

// A room that runs the restore's edit and answers `result`
function fakeRoom(result: RestoreResult) {
  return {
    doc: new Doc(),
    lineage: 'one',
    flush: vi.fn(() => Promise.resolve()),
    isCommitted: () => true,
    restoreVersion: vi.fn(async (_seq: number, edit: () => void) => {
      edit()
      return result
    }),
  }
}

function refuseConvert(): Promise<ConvertedVersion> {
  return Promise.resolve({ refused: null })
}

// An old version, which the server converts before it restores, whose stored HTML is out of date
function oldVersion(collab = 0) {
  return encode({ schema: 'writer-document/1', content: 'AAA=', html: '<p>stale</p>', collab })
}

function converted(text: string): Promise<ConvertedVersion> {
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text }] }
  const doc = prosemirrorJSONToYDoc(schema, { type: 'doc', content: [paragraph] }, BODY_FIELD)
  return Promise.resolve({ body: { lineage: '', state: encodeStateAsUpdate(doc) } })
}

function html(value: string) {
  return new TextEncoder().encode(value)
}

function shown(doc: Doc) {
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(BODY_FIELD))
  return schema.nodeFromJSON(json).textContent
}

// A document of one paragraph, "hello world", whose text a thread on "world" holds
function documentWithThread() {
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }
  const doc = prosemirrorJSONToYDoc(schema, { type: 'doc', content: [paragraph] }, BODY_FIELD)
  const text = textOf(doc)
  const anchor = encodeAnchor(
    createRelativePositionFromTypeIndex(text, 6, 0),
    createRelativePositionFromTypeIndex(text, 11, -1),
    'world',
  )
  return { doc, threads: [{ name: 't1', anchor }] }
}

function textOf(doc: Doc) {
  const paragraph = doc.getXmlFragment(BODY_FIELD).get(0) as XmlElement
  return paragraph.get(0) as XmlText
}

async function yjsVersion(doc: Doc) {
  const raw = new Response(new Uint8Array(encodeStateAsUpdate(doc))).body!
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
function covered(doc: Doc, anchor: string) {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return null
  }

  const from = createAbsolutePositionFromRelativePosition(read.start, doc)!
  const to = createAbsolutePositionFromRelativePosition(read.end, doc)!
  return (from.type as XmlText).toString().slice(from.index, to.index)
}

// A restore after "world" was deleted, in a room whose server holds what it is told to
async function restoreLostWorld(result: RestoreResult, isSaved: boolean) {
  const { doc, threads } = documentWithThread()
  const bytes = await yjsVersion(doc)
  textOf(doc).delete(5, 6)
  const room = { ...fakeRoom(result), doc, isCommitted: () => isSaved }
  const notice = await restoreVersion(room, 4, bytes, threads, refuseConvert)
  return { doc, notice }
}

describe('restoreVersion', () => {
  it('saves first, then makes the document the version', async () => {
    const room = fakeRoom({ outcome: 'landed' })

    const notice = await restoreVersion(room, 4, html('<p>back then</p>'), [], refuseConvert)

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

    const notice = await restoreVersion(room, 4, new Uint8Array([0xff, 0xfe]), [], refuseConvert)

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
      const notice = await restoreVersion(fakeRoom(result), 4, html('<p>x</p>'), [], refuseConvert)

      expect(notice).toEqual({ isRestored, message, anchors: {} })
    },
  )

  it('restores nothing while the server is still upgrading an old version', async () => {
    const room = fakeRoom({ outcome: 'landed' })

    const notice = await restoreVersion(room, 4, oldVersion(), [], () =>
      Promise.resolve({ isPending: true }),
    )

    expect([notice, room.restoreVersion.mock.calls.length]).toEqual([
      {
        isRestored: false,
        message: 'This version is still being upgraded. Try restoring it again in a minute.',
        anchors: {},
      },
      0,
    ])
  })

  it.each([0, 1])(
    'restores an old version (collab %s) as the converter made it, not its stored HTML',
    async (collab) => {
      const room = fakeRoom({ outcome: 'landed' })

      const notice = await restoreVersion(room, 4, oldVersion(collab), [], () =>
        converted('back then'),
      )

      expect([notice.isRestored, shown(room.doc)]).toEqual([true, 'back then'])
    },
  )

  it.each([
    [null, "This version couldn't be upgraded, so it can't be restored. You can download it."],
    [
      'too_large',
      "This version couldn't be upgraded, so it can't be restored. You can download it. Reason: too_large.",
    ],
  ])(
    'offers the download of an old version the converter refuses (%s)',
    async (reason, message) => {
      const room = fakeRoom({ outcome: 'landed' })

      const notice = await restoreVersion(room, 4, oldVersion(), [], () =>
        Promise.resolve({ refused: reason }),
      )

      expect([notice, room.restoreVersion.mock.calls.length]).toEqual([
        { isRestored: false, message, canDownload: true, anchors: {} },
        0,
      ])
    },
  )

  it('restores nothing when converting an old version fails', async () => {
    const room = fakeRoom({ outcome: 'landed' })

    const restore = restoreVersion(room, 4, oldVersion(), [], () =>
      Promise.reject(new Error('down')),
    )

    await expect(restore).rejects.toThrow('down')
    expect(room.restoreVersion.mock.calls.length).toBe(0)
  })
})
