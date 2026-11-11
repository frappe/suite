import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { writeDeck } from '@/apps/slides/collab/deck'
import { drawnSlides } from '@/apps/slides/collab/drawnDeck'
import type { RestoreResult } from '@/platform/collab'

import { restoreVersion } from './restoreVersion'
import type { ConvertedVersion } from './versions'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const FRAME = { left: 10, top: 10, width: 100, height: 50 }

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
  }
  return new TextEncoder().encode(JSON.stringify(record))
}

// A room that takes the restore as the server would: the edit runs, and the restore lands
// An old row version, as Slides stored them before collaboration
const ROW_VERSION = new TextEncoder().encode(
  JSON.stringify({ schema: 'presentation/1', slides: [] }),
)

function noUpgrade(): Promise<ConvertedVersion> {
  throw new Error('A converted version needs no upgrade')
}

function roomOn(doc: Y.Doc) {
  return {
    doc,
    flush: vi.fn(async () => {}),
    restoreVersion: vi.fn(async (_seq: number, edit: () => void): Promise<RestoreResult> => {
      edit()
      return { outcome: 'landed' }
    }),
  }
}

describe('restoring a version of a converted presentation', () => {
  it('makes the presentation the version, and says so', async () => {
    const then = new Y.Doc()
    writeDeck(then, [{ id: 'one', elements: [{ id: 'title', type: 'text', frame: FRAME }] }])
    const now = new Y.Doc()
    Y.applyUpdate(now, Y.encodeStateAsUpdate(then))
    writeDeck(now, [{ id: 'added', elements: [] }])
    const room = roomOn(now)

    const notice = await restoreVersion(room, 4, await storedVersion(then), () => {}, noUpgrade)

    expect(drawnSlides(now)).toEqual(drawnSlides(then))
    expect(notice).toEqual({ isRestored: true, message: 'Version restored' })
  })

  it('refuses bytes it cannot read, and leaves the presentation alone', async () => {
    const room = roomOn(new Y.Doc())

    const notice = await restoreVersion(
      room,
      4,
      new TextEncoder().encode('{}'),
      () => {},
      noUpgrade,
    )

    expect(notice).toEqual({ isRestored: false, message: "This version can't be restored." })
    expect(room.restoreVersion).not.toHaveBeenCalled()
  })

  describe('from before collaboration', () => {
    it('restores what the server upgraded it to', async () => {
      const then = new Y.Doc()
      writeDeck(then, [{ id: 'one', elements: [{ id: 'title', type: 'text', frame: FRAME }] }])
      const now = new Y.Doc()
      writeDeck(now, [{ id: 'other', elements: [] }])
      const room = roomOn(now)
      const upgraded = { state: Y.encodeStateAsUpdate(then) }

      const notice = await restoreVersion(
        room,
        2,
        ROW_VERSION,
        () => {},
        async () => upgraded,
      )

      expect(drawnSlides(now)).toEqual(drawnSlides(then))
      expect(notice).toEqual({ isRestored: true, message: 'Version restored' })
    })

    it('restores nothing while the server is still upgrading it, and says to try again', async () => {
      const room = roomOn(new Y.Doc())

      const notice = await restoreVersion(
        room,
        2,
        ROW_VERSION,
        () => {},
        async () => ({
          isPending: true,
        }),
      )

      expect(notice).toEqual({
        isRestored: false,
        message: 'This version is still being upgraded. Try restoring it again in a minute.',
      })
      expect(room.restoreVersion).not.toHaveBeenCalled()
    })

    it('restores nothing the server refused, gives the reason and offers the version', async () => {
      const room = roomOn(new Y.Doc())

      const notice = await restoreVersion(
        room,
        2,
        ROW_VERSION,
        () => {},
        async () => ({
          refused: 'combined',
        }),
      )

      expect(notice).toEqual({
        isRestored: false,
        message:
          "This version couldn't be upgraded, so it can't be restored. You can download it. Reason: it is a combined presentation, with no slides of its own.",
        canDownload: true,
      })
      expect(room.restoreVersion).not.toHaveBeenCalled()
    })
  })
})
