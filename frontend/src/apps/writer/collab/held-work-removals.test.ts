import { REMOTE } from '@suite/collab-client'
import {
  device,
  fakeLocks,
  fakeServer,
  fakeTime,
  idle,
  join,
  type FakeServer,
} from '@suite/collab-client/test-support'
import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import {
  docOf,
  makeRoomHeading,
  mention,
  neverKept,
  oldBlockText,
  removalsOnApply,
  removeOldBlock,
  roomBlocks,
  roomText,
  threeParagraphs,
} from '@/apps/writer/collab/removal-fixtures'
import { watchRemovals, type Removal } from '@/apps/writer/collab/removals'
import { ADOPT } from '@/platform/collab'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

describe("work a tab takes on that the doc already held as another tab's (R310)", () => {
  // A row that makes the old block a heading, from a tab that never saw the typing
  function unseenRestructure() {
    const other = docOf(threeParagraphs)
    const base = yjs.encodeStateVector(other)
    removeOldBlock(other)
    return yjs.encodeStateAsUpdate(other, base)
  }

  // The writer types into the old block, an update per edit as its outbox keeps them, the reader
  // pulls that as another tab's row, `after` runs on the reader, then the reader takes the work on
  function adoptHeld(
    type: (old: yjs.XmlText) => void,
    after: (reader: yjs.Doc) => void,
    reader = docOf(threeParagraphs),
  ) {
    const writer = docOf(threeParagraphs)
    const typed: Uint8Array[] = []
    writer.on('update', (update: Uint8Array) => typed.push(update))
    type(oldBlockText(writer))
    yjs.applyUpdate(reader, yjs.mergeUpdates(typed), REMOTE)
    after(reader)
    return removalsOnApply(reader, typed, writer, ADOPT)
  }

  function typeQQAt2(old: yjs.XmlText) {
    old.insert(2, 'QQ')
  }

  function applyRestructure(reader: yjs.Doc) {
    yjs.applyUpdate(reader, unseenRestructure(), REMOTE)
  }

  it('reports my text the doc held once a row removed its block', () => {
    expect(adoptHeld(typeQQAt2, applyRestructure)).toEqual([neverKept('QQ')])
  })

  it('reports nothing of held text still in the doc', () => {
    expect(adoptHeld(typeQQAt2, () => {})).toEqual([])
  })

  it('reports nothing of work that waits on a change the doc never got', () => {
    const writer = docOf(threeParagraphs)
    const typed: Uint8Array[] = []
    writer.on('update', (update: Uint8Array) => typed.push(update))
    oldBlockText(writer).insert(2, 'QQ')
    oldBlockText(writer).insert(4, 'RR')
    const reader = docOf(threeParagraphs)

    const found = removalsOnApply(reader, typed.slice(1), writer, ADOPT)

    const isWaiting = !!reader.store.pendingStructs
    expect([found, oldBlockText(reader).toString(), isWaiting]).toEqual([[], 'defgh', true])
  })

  it('reports nothing of held text someone deleted in a block still there', () => {
    const found = adoptHeld(typeQQAt2, (reader) => oldBlockText(reader).delete(2, 2))

    expect(found).toEqual([])
  })

  function typeAndDeleteQQ(old: yjs.XmlText) {
    old.insert(2, 'QQ')
    old.delete(2, 2)
  }

  it('reports nothing of held text the closed tab deleted itself', () => {
    expect(adoptHeld(typeAndDeleteQQ, applyRestructure)).toEqual([])
  })

  it('reports held text in a removed block the doc keeps uncollected', () => {
    const reader = new yjs.Doc({ gc: false })
    yjs.applyUpdate(reader, threeParagraphs)

    expect(adoptHeld(typeQQAt2, applyRestructure, reader)).toEqual([neverKept('QQ')])
  })

  it('reports held bold text as bold', () => {
    const found = adoptHeld((old) => old.insert(2, 'QQ', { bold: {} }), applyRestructure)

    expect(found).toEqual([
      { ...neverKept('QQ'), runs: [{ offset: 0, text: 'QQ', attrs: { bold: {} } }] },
    ])
  })

  // A restructure that saw the typing carries it into the heading, which no adopt can tell
  function carryIntoHeading(reader: yjs.Doc) {
    const words = oldBlockText(reader).toString()
    const heading = new yjs.XmlElement('heading')
    heading.insert(0, [new yjs.XmlText(words)])
    const body = reader.getXmlFragment(BODY_FIELD)
    reader.transact(() => {
      body.delete(1, 1)
      body.insert(1, [heading])
    })
  }

  it('reports held text a restructure carried into its heading, as a spare copy', () => {
    const reader = docOf(threeParagraphs)

    const found = adoptHeld(typeQQAt2, carryIntoHeading, reader)

    expect([oldBlockText(reader).toString(), found]).toEqual(['deQQfgh', [neverKept('QQ')]])
  })

  it('reports held text another tab deleted before its block went, as a spare copy (R326)', () => {
    const found = adoptHeld(typeQQAt2, (reader) => {
      oldBlockText(reader).delete(2, 2)
      applyRestructure(reader)
    })

    expect(found).toEqual([neverKept('QQ')])
  })

  it('keys lost text by every lost character, alike each time the same work is taken on', () => {
    const writer = docOf(threeParagraphs)
    const base = yjs.encodeStateVector(writer)
    oldBlockText(writer).insert(2, 'QQ')
    const typedQQ = yjs.encodeStateAsUpdate(writer, base)
    oldBlockText(writer).insert(4, 'R')
    const typedQQR = yjs.encodeStateAsUpdate(writer, base)

    const keys = [typedQQ, typedQQ, typedQQR].map((typed) => {
      const reader = docOf(threeParagraphs)
      yjs.applyUpdate(reader, typed, REMOTE)
      applyRestructure(reader)
      return removalsOnApply(reader, [typed], writer, ADOPT).map((removal) => removal.key)
    })

    const id = writer.clientID
    expect(keys).toEqual([[`${id}:0+2`], [`${id}:0+2`], [`${id}:0+3`]])
  })

  it('keys a lost mention by its own item, alike each time the same work is taken on', () => {
    const writer = docOf(threeParagraphs)
    const base = yjs.encodeStateVector(writer)
    ;(oldBlockText(writer).parent as yjs.XmlElement).insert(1, [mention()])
    const typed = yjs.encodeStateAsUpdate(writer, base)

    const keys = [typed, typed].map((update) => {
      const reader = docOf(threeParagraphs)
      yjs.applyUpdate(reader, update, REMOTE)
      applyRestructure(reader)
      return removalsOnApply(reader, [update], writer, ADOPT).map((removal) => removal.key)
    })

    const id = writer.clientID
    expect(keys).toEqual([[`${id}:0+1`], [`${id}:0+1`]])
  })

  function typeAndCut(old: yjs.XmlText) {
    old.insert(2, 'QQ')
    old.insert(4, 'RR')
    old.delete(3, 1)
  }

  it('keys a lost run the closed tab deleted inside by each stretch it lost', () => {
    const found = adoptHeld(typeAndCut, applyRestructure)

    const runs = found.map((removal) => removal.kind === 'text' && removal.runs[0].text)
    expect([runs, found.map((removal) => removal.key)]).toEqual([
      ['QRR'],
      [expect.stringMatching(/^\d+:0\+1,\d+:2\+2$/)],
    ])
  })

  it('reports a held mention as one lost node', () => {
    const found = adoptHeld(
      (old) => (old.parent as yjs.XmlElement).insert(1, [mention()]),
      applyRestructure,
    )

    expect(found).toEqual([{ kind: 'node', name: 'mention', attrs: {}, key: expect.any(String) }])
  })

  // Endpoints whose pushes reach the server and whose answers never come back, as a closing page's keepalive
  function unansweredPushes(server: FakeServer) {
    const endpoints = { ...server.endpoints() }
    const push = endpoints.push
    endpoints.push = async (body, request) => {
      await push(body, request)
      throw new TypeError('Failed to fetch')
    }

    return endpoints
  }

  it("reports a closed tab's sent typing a live tab pulled as another's, once it takes the work on", async () => {
    fakeLocks()
    fakeTime()
    try {
      const server = fakeServer()
      const first = await join(server.endpoints())
      yjs.applyUpdate(first.doc, threeParagraphs)
      await first.flush()
      const kept = await device()
      const live = await join(server.endpoints(), { device: kept })
      const closing = await join(unansweredPushes(server), { device: kept, pollMs: 3_600_000 })
      const reported: Removal[] = []
      watchRemovals(live, (removals) => reported.push(...removals))

      makeRoomHeading(first, 'defgh')
      roomText(closing, 1).insert(2, 'QQ')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      await first.flush()
      await live.pull()
      const isPulledFirst = live.doc.store.clients.has(closing.doc.clientID)
      const pulledReports = [...reported]
      await closing.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()

      expect([isPulledFirst, pulledReports, roomBlocks(live), reported]).toEqual([
        true,
        [],
        ['paragraph abc', 'heading defgh', 'paragraph xyz'],
        [neverKept('QQ')],
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
