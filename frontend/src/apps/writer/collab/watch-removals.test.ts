import { REMOTE } from '@suite/collab-client'
import {
  device,
  fakeLocks,
  fakeServer,
  fakeTime,
  idle,
  join,
  offlinePushes,
  type FakeServer,
} from '@suite/collab-client/test-support'
import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import {
  allReported,
  docOf,
  lostQQ,
  makeHeading,
  makeRoomHeading,
  mention,
  neverKept,
  oldBlockText,
  removalsOnApply,
  removeOldBlock,
  roomBlocks,
  roomText,
  sendInOrder,
  threeParagraphs,
  typeQQ,
} from '@/apps/writer/collab/removal-fixtures'
import { watchRemovals, type Removal } from '@/apps/writer/collab/removals'
import { blocks, openTabs, sendRow, syncAll } from '@/apps/writer/collab/test-support'
import { APPLIED_UPDATE, type CollabRoom } from '@/platform/collab'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

// Real rooms on one device: a tab whose pushes fail turns defgh into a heading reading `heading`,
// this tab types QQ into the old block, `beforeClose` runs, then the other tab closes and this one takes its work on
async function takeOverHeading(heading: string, beforeClose = async (_server: FakeServer) => {}) {
  fakeTime()
  const server = fakeServer()
  const first = await join(server.endpoints())
  yjs.applyUpdate(first.doc, threeParagraphs)
  await first.flush()
  const kept = await device()
  const typing = await join(server.endpoints(), { device: kept })
  const closing = await join(offlinePushes(server), { device: kept })
  const reported: Removal[] = []
  watchRemovals(typing, (removals) => reported.push(...removals))

  makeRoomHeading(closing, heading)
  await vi.advanceTimersByTimeAsync(0)
  await idle()
  roomText(typing, 1).insert(2, 'QQ')
  await beforeClose(server)
  await closing.close()
  await vi.advanceTimersByTimeAsync(60_000)
  await idle()
  return { first, typing, reported }
}

describe('a room watching for removals', () => {
  it("types back the text a tab took on from a closed tab's outbox (R295)", async () => {
    const [headingTab, typingTab, closedTab] = await openTabs(threeParagraphs, 3)
    typeQQ(closedTab, 'defgh')
    yjs.applyUpdate(typingTab.ydoc, sendRow(closedTab)!, 'adopt')
    typingTab.room.ownClients.add(closedTab.ydoc.clientID)
    makeHeading(headingTab, 'defgh')
    const tabs = [headingTab, typingTab]

    await sendInOrder(tabs, tabs)

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyz'])
    }

    expect(allReported(tabs)).toEqual([])
  })

  it("types back what a closed tab's restructure removed once this tab takes it on (R298)", async () => {
    fakeLocks()
    try {
      const { typing, reported } = await takeOverHeading('defgh')

      expect(roomBlocks(typing)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyz'])
      expect(reported).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("reports what a closed tab's restructure removed when this tab takes it on and can't place it (R298)", async () => {
    fakeLocks()
    try {
      const { typing, reported } = await takeOverHeading('defghX')

      expect(roomBlocks(typing)).toEqual(['paragraph abc', 'heading defghX', 'paragraph xyz'])
      expect(reported).toEqual([lostQQ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // A tab types into defgh and closes without sending it, another makes the block a heading and sends it,
  // then a tab opens on the same device, with or without the network, watched before it applies anything
  async function reopenAfterRestructure(
    isOnline: boolean,
    typeOffline = (old: yjs.XmlText) => old.insert(2, 'QQ'),
  ) {
    fakeTime()
    const server = fakeServer()
    const first = await join(server.endpoints())
    yjs.applyUpdate(first.doc, threeParagraphs)
    await first.flush()
    const kept = await device()
    const closing = await join(offlinePushes(server), { device: kept })
    typeOffline(roomText(closing, 1))
    await vi.advanceTimersByTimeAsync(0)
    await idle()
    await closing.close()
    makeRoomHeading(first, 'defgh')
    await first.flush()
    server.access.online = isOnline
    const reported: Removal[] = []
    const reopened = await join(server.endpoints(), {
      device: kept,
      pollMs: 1000,
      watch: (room) => {
        watchRemovals(room, (removals) => reported.push(...removals))
      },
    })
    server.access.online = true
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await idle()
    await reopened.flush()
    await first.pull()
    return { rooms: [first, reopened], reported }
  }

  it('types back what a restructure removed from the work a tab opened offline took on, once it claims (R299)', async () => {
    fakeLocks()
    try {
      const { rooms, reported } = await reopenAfterRestructure(false)

      for (const room of rooms) {
        expect(roomBlocks(room)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyz'])
      }

      expect(reported).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports what a restructure removed from the work a tab takes on as it opens (R308)', async () => {
    fakeLocks()
    try {
      const { rooms, reported } = await reopenAfterRestructure(true)

      for (const room of rooms) {
        expect(roomBlocks(room)).toEqual(['paragraph abc', 'heading defgh', 'paragraph xyz'])
      }

      expect(reported).toEqual([neverKept('QQ')])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports nothing of what the closed tab typed and deleted itself as a tab takes it on (R308)', async () => {
    fakeLocks()
    try {
      const { rooms, reported } = await reopenAfterRestructure(true, (old) => {
        old.insert(2, 'QQ')
        old.delete(2, 2)
      })

      expect([roomBlocks(rooms[1]), reported]).toEqual([
        ['paragraph abc', 'heading defgh', 'paragraph xyz'],
        [],
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports only what the closed tab typed and kept as a tab takes it on (R308)', async () => {
    fakeLocks()
    try {
      const { reported } = await reopenAfterRestructure(true, (old) => {
        old.insert(2, 'QQRR')
        old.delete(2, 2)
      })

      expect(reported).toEqual([neverKept('RR')])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports bold text the closed tab typed as bold as a tab takes it on (R308)', async () => {
    fakeLocks()
    try {
      const { reported } = await reopenAfterRestructure(true, (old) =>
        old.insert(2, 'QQ', { bold: {} }),
      )

      expect(reported).toEqual([
        { ...neverKept('QQ'), runs: [{ offset: 0, text: 'QQ', attrs: { bold: {} } }] },
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports a mention the closed tab added as one lost node as a tab takes it on (R308)', async () => {
    fakeLocks()
    try {
      const { reported } = await reopenAfterRestructure(true, (old) =>
        (old.parent as yjs.XmlElement).insert(1, [mention()]),
      )

      expect(reported).toEqual([
        { kind: 'node', name: 'mention', attrs: {}, key: expect.any(String) },
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("reports a closed tab's typing a tab takes on after it pulled the restructure (R308)", async () => {
    fakeLocks()
    fakeTime()
    try {
      const server = fakeServer()
      const first = await join(server.endpoints())
      yjs.applyUpdate(first.doc, threeParagraphs)
      await first.flush()
      const kept = await device()
      const typing = await join(server.endpoints(), { device: kept })
      const closing = await join(offlinePushes(server), { device: kept })
      const reported: Removal[] = []
      watchRemovals(typing, (removals) => reported.push(...removals))
      roomText(closing, 1).insert(2, 'QQ')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      makeRoomHeading(first, 'defgh')
      await first.flush()
      await typing.pull()
      await closing.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()

      expect([roomBlocks(typing), reported]).toEqual([
        ['paragraph abc', 'heading defgh', 'paragraph xyz'],
        [neverKept('QQ')],
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("doesn't report another tab's text or mention written into a block already gone (R308)", async () => {
    fakeTime()
    const server = fakeServer()
    const first = await join(server.endpoints())
    yjs.applyUpdate(first.doc, threeParagraphs)
    await first.flush()
    const typing = await join(server.endpoints())
    const other = await join(server.endpoints())
    const reported: Removal[] = []
    watchRemovals(typing, (removals) => reported.push(...removals))

    makeRoomHeading(first, 'defgh')
    await first.flush()
    await typing.pull()
    roomText(other, 1).insert(2, 'ZZ')
    ;(roomText(other, 1).parent as yjs.XmlElement).insert(1, [mention()])
    await other.flush()
    await typing.pull()

    expect([roomBlocks(typing), reported]).toEqual([
      ['paragraph abc', 'heading defgh', 'paragraph xyz'],
      [],
    ])
  })

  it('reports only the part of an update of mine the doc never held before it was gone (R308)', () => {
    const writer = docOf(threeParagraphs)
    const reader = docOf(threeParagraphs)
    const base = yjs.encodeStateVector(writer)
    oldBlockText(writer).insert(2, 'QQ')
    const typedQQ = yjs.encodeStateAsUpdate(writer, base)
    oldBlockText(writer).insert(4, 'RR')
    const typedBoth = yjs.encodeStateAsUpdate(writer, base)
    yjs.applyUpdate(reader, typedQQ)
    removeOldBlock(reader)

    const found = removalsOnApply(reader, [typedBoth], writer)

    expect(found).toEqual([neverKept('RR')])
  })

  it("reports only my text of one apply that also wrote another's into a block already gone (R308)", () => {
    const writer = docOf(threeParagraphs)
    const other = docOf(threeParagraphs)
    const reader = docOf(threeParagraphs)
    const base = yjs.encodeStateVector(writer)
    oldBlockText(writer).insert(2, 'QQ')
    oldBlockText(other).insert(2, 'ZZ')
    const typed = [yjs.encodeStateAsUpdate(writer, base), yjs.encodeStateAsUpdate(other, base)]
    removeOldBlock(reader)

    const found = removalsOnApply(reader, typed, writer)

    expect(found).toEqual([neverKept('QQ')])
  })

  // A third tab sends ZZ at `offset` in the old block once the type-back is out, so the taking-on
  // tab never sees it, then pulls the taken-on heading and the type-back together
  async function thirdTabTyping(offset: number) {
    let third!: CollabRoom
    const thirdReported: Removal[] = []
    const { first, typing } = await takeOverHeading('defgh', async (server) => {
      third = await join(server.endpoints(), { pollMs: 3_600_000 })
      watchRemovals(third, (removals) => thirdReported.push(...removals))
    })
    await typing.flush()
    expect(roomText(third, 1).toString()).toBe('defgh')
    roomText(third, 1).insert(offset, 'ZZ')
    await third.flush()
    await third.pull()
    await third.flush()
    await typing.pull()
    await first.pull()
    return { rooms: [first, typing, third], thirdReported }
  }

  it("types back a third tab's sent text once it pulls the taken-on heading and the type-back together (R305)", async () => {
    fakeLocks()
    try {
      const { rooms, thirdReported } = await thirdTabTyping(4)

      for (const room of rooms) {
        expect(roomBlocks(room)).toEqual(['paragraph abc', 'heading deQQfgZZh', 'paragraph xyz'])
      }

      expect(thirdReported).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("reports a third tab's text sent where the type-back's tab typed too (R305)", async () => {
    fakeLocks()
    try {
      const { rooms, thirdReported } = await thirdTabTyping(2)

      for (const room of rooms) {
        expect(roomBlocks(room)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyz'])
      }

      const runs = [{ offset: 2, text: 'ZZ', attrs: {} }]
      expect(thirdReported).toEqual([{ ...lostQQ, runs, isUncertain: true }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('types back what a row removed though a row pulled with it typed into its copy (R297)', async () => {
    fakeTime()
    const server = fakeServer()
    const writing = await join(server.endpoints())
    yjs.applyUpdate(writing.doc, threeParagraphs)
    await writing.flush()
    const typing = await join(offlinePushes(server))
    const reported: Removal[] = []
    watchRemovals(typing, (removals) => reported.push(...removals))

    makeRoomHeading(writing, 'defgh')
    await writing.flush()
    roomText(writing, 1).insert(5, 'ZZ')
    await writing.flush()
    roomText(typing, 1).insert(4, 'RR')
    await typing.pull()

    expect(roomBlocks(typing)).toEqual(['paragraph abc', 'heading defgRRhZZ', 'paragraph xyz'])
    expect(reported).toEqual([])
  })

  it('reports what a row removed when a row pulled with it deleted part of its copy (R305)', async () => {
    fakeTime()
    const server = fakeServer()
    const writing = await join(server.endpoints())
    yjs.applyUpdate(writing.doc, threeParagraphs)
    await writing.flush()
    const typing = await join(offlinePushes(server))
    const reported: Removal[] = []
    watchRemovals(typing, (removals) => reported.push(...removals))

    makeRoomHeading(writing, 'defgh')
    await writing.flush()
    roomText(writing, 1).delete(0, 1)
    await writing.flush()
    roomText(typing, 1).insert(2, 'QQ')
    await typing.pull()

    expect(roomBlocks(typing)).toEqual(['paragraph abc', 'heading efgh', 'paragraph xyz'])
    expect(reported).toEqual([lostQQ])
  })

  // One pull: a row deletes `de` in place, then a row from another tab makes the block a heading
  async function deleteThenRestructure(hasSeenDelete: boolean) {
    fakeTime()
    const server = fakeServer()
    const deleting = await join(server.endpoints())
    yjs.applyUpdate(deleting.doc, threeParagraphs)
    await deleting.flush()
    const restructuring = await join(server.endpoints())
    const typing = await join(offlinePushes(server))
    const reported: Removal[] = []
    watchRemovals(typing, (removals) => reported.push(...removals))

    roomText(deleting, 1).delete(0, 2)
    await deleting.flush()
    if (hasSeenDelete) {
      await restructuring.pull()
    }

    makeRoomHeading(restructuring, roomText(restructuring, 1).toString())
    await restructuring.flush()
    roomText(typing, 1).insert(2, 'QQ')
    await typing.pull()
    return { typing, reported }
  }

  it('reports what a restructure removed when a row pulled before it deleted part of the old text', async () => {
    const { typing, reported } = await deleteThenRestructure(true)

    expect(roomBlocks(typing)).toEqual(['paragraph abc', 'heading fgh', 'paragraph xyz'])
    expect(reported).toEqual([lostQQ])
  })

  it('types back what a restructure removed when a row pulled with it deleted old text the restructure copied', async () => {
    const { typing, reported } = await deleteThenRestructure(false)

    expect(roomBlocks(typing)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyz'])
    expect(reported).toEqual([])
  })

  it('reports instead of typing back when the room cannot write (R282)', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'defgh')
    typeQQ(typingTab, 'defgh')
    typingTab.room.status = { canWrite: false }

    await sendInOrder(tabs, tabs)

    expect(blocks(typingTab)).toEqual(['paragraph abc', 'heading defgh', 'paragraph xyz'])
    expect(typingTab.reported).toEqual([lostQQ])
  })

  it('stops watching once stopped', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, typingTab] = tabs
    typingTab.room.status = { canWrite: false }
    const stoppedReports: Removal[] = []
    watchRemovals(typingTab.room, (removals) => stoppedReports.push(...removals))()
    makeHeading(headingTab, 'defgh')
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect([typingTab.reported, stoppedReports]).toEqual([[lostQQ], []])
  })

  it('reports what it collected but was never told of once stopped, typing none of it back', async () => {
    const [headingTab, typingTab] = await openTabs(threeParagraphs, 2)
    const stoppedReports: Removal[] = []
    const stop = watchRemovals(typingTab.room, (removals) => stoppedReports.push(...removals))
    makeHeading(headingTab, 'defgh')
    typeQQ(typingTab, 'defgh')
    const row = sendRow(headingTab)!
    typingTab.ydoc.transact((transaction) => {
      transaction.meta.set(APPLIED_UPDATE, [row])
      yjs.applyUpdate(typingTab.ydoc, row, REMOTE)
    }, REMOTE)

    stop()

    expect(blocks(typingTab)).toEqual(['paragraph abc', 'heading defgh', 'paragraph xyz'])
    expect([stoppedReports, typingTab.reported]).toEqual([[lostQQ], []])
  })

  it('leaves typed-back text in place when the tab undoes', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'defgh')
    typeQQ(typingTab, 'defgh')
    await sendInOrder(tabs, tabs)

    typingTab.editor.commands.undo()
    await syncAll(tabs)

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyz'])
    }
  })
})
