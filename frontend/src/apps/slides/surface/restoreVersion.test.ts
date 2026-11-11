import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { writeDeck } from '@/apps/slides/collab/deck'
import { drawnSlides } from '@/apps/slides/collab/drawnDeck'
import type { RestoreResult } from '@/platform/collab'

import { restoreVersion } from './restoreVersion'

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

    const notice = await restoreVersion(room, 4, await storedVersion(then), () => {})

    expect(drawnSlides(now)).toEqual(drawnSlides(then))
    expect(notice).toEqual({ isRestored: true, message: 'Version restored' })
  })

  it('refuses bytes it cannot read, and leaves the presentation alone', async () => {
    const room = roomOn(new Y.Doc())

    const notice = await restoreVersion(room, 4, new TextEncoder().encode('{}'), () => {})

    expect(notice).toEqual({ isRestored: false, message: "This version can't be restored." })
    expect(room.restoreVersion).not.toHaveBeenCalled()
  })
})
