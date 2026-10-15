import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  device,
  fakeServer,
  fakeTime,
  idle,
  join,
  reply,
  text,
  type FakeServer,
} from './test-support'
import type { CollabRoom } from './types'

// The update another tab's restore sends: the document as the server holds it, made `version`
function restoreTo(server: FakeServer, version: string) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.mergeUpdates(server.rows.map((row) => row.bytes)))
  const before = Y.encodeStateVector(doc)
  const body = doc.getText('t')
  body.delete(0, body.length)
  body.insert(0, version)
  return Y.encodeStateAsUpdate(doc, before)
}

function type(room: CollabRoom, word: string) {
  const body = room.doc.getText('t')
  body.insert(body.length, word)
}

async function serverWith(word: string) {
  const server = fakeServer()
  const writer = await join(server.endpoints())
  type(writer, word)
  await writer.flush()
  return server
}

async function reasonsKept(kept: Awaited<ReturnType<typeof device>>) {
  return (await kept.store.recovery('D')).map((copy) => copy.reason)
}

describe('work from before a restore', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a live tab keeps what it typed before the restore as a recovery copy and is rebuilt', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept, socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)

    type(room, ' mine')
    server.fence(120_000)
    await vi.advanceTimersByTimeAsync(200)
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    server.landRestore(restoreTo(server, 'old'))
    // Before the pull a notice spreads, and before the paused push is tried again
    await vi.advanceTimersByTimeAsync(10)
    await idle()

    expect([room.stopped, room.needsRebuild]).toEqual(['restored', true])
    expect(await reasonsKept(kept)).toEqual(['restored'])
    expect(text(await join(server.endpoints()))).toBe('old')
  })

  it('a polling tab stops at the pull that tells it of the restore, before showing it over its work', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    type(room, ' mine')
    server.fence(120_000)
    await vi.advanceTimersByTimeAsync(0)
    server.landRestore(restoreTo(server, 'old'))
    await room.pull()
    await vi.waitFor(() => expect(room.needsRebuild).toBe(true))

    expect([room.stopped, text(room)]).toEqual(['restored', 'draft mine'])
    expect(await reasonsKept(kept)).toEqual(['restored'])
  })

  it('work typed before a restore is refused even once the tab shows the restore', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept, socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    type(room, ' mine')
    server.fence(120_000)
    await vi.advanceTimersByTimeAsync(200)

    server.landRestore(restoreTo(server, 'old'), 'notice')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(room.needsRebuild).toBe(true))

    expect([room.appliedThrough, room.stopped, await reasonsKept(kept)]).toEqual([
      2,
      'restored',
      ['restored'],
    ])
    expect(text(await join(server.endpoints()))).toBe('old')
  })

  it('work sent by a tab that heard nothing of the restore is refused and kept', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.landRestore(restoreTo(server, 'old'))

    type(room, ' mine')
    await room.flush()
    await vi.waitFor(() => expect(room.needsRebuild).toBe(true))

    expect([room.stopped, await reasonsKept(kept)]).toEqual(['restored', ['restored']])
    expect(text(await join(server.endpoints()))).toBe('old')
  })

  it('work a closed tab left on the device from before the restore is kept aside, not shown', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const first = await join(server.endpoints(), { device: kept })
    server.access.online = false
    type(first, ' offline')
    await vi.advanceTimersByTimeAsync(0)
    await first.close()
    server.access.online = true
    server.landRestore(restoreTo(server, 'old'))

    const next = await join(server.endpoints(), { device: kept })
    await next.flush()

    expect([text(next), next.stopped, next.unsent]).toEqual(['old', null, 0])
    expect(await reasonsKept(kept)).toEqual(['restored'])
    expect(text(await join(server.endpoints()))).toBe('old')
  })

  it('a tab with nothing unsent takes the restore and keeps editing', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    server.fence(120_000)
    await vi.advanceTimersByTimeAsync(200)

    server.landRestore(restoreTo(server, 'old'))
    await vi.advanceTimersByTimeAsync(2_000)
    type(room, ' new')
    await room.flush()

    expect([text(room), room.stopped, room.canWrite, room.unsent]).toEqual([
      'old new',
      null,
      true,
      0,
    ])
    expect(text(await join(server.endpoints()))).toBe('old new')
  })

  it('a tab that hears of a restore before it holds it waits to edit until it does', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    server.fence(120_000)
    await vi.advanceTimersByTimeAsync(200)
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    server.landRestore(restoreTo(server, 'old'), 'row')
    await vi.advanceTimersByTimeAsync(10)
    const before = [room.restoring, room.canWrite, text(room)]
    await vi.advanceTimersByTimeAsync(60_000)

    expect(before).toEqual([true, false, 'draft'])
    expect([room.restoring, room.canWrite, text(room)]).toEqual([false, true, 'old'])
  })
})

// The edit that makes the room's document `version`
function becomes(room: CollabRoom, version: string) {
  return () => {
    const body = room.doc.getText('t')
    body.delete(0, body.length)
    body.insert(0, version)
  }
}

describe("this tab's restore", () => {
  it('lands as one push under the fence, even when the notice comes before the answer', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    const token = server.fence(120_000)
    await vi.advanceTimersByTimeAsync(200)

    const outcome = await room.restore(token, becomes(room, 'old'))

    expect([outcome, room.restoreRev, room.stopped, room.canWrite]).toEqual([
      'landed',
      2,
      null,
      true,
    ])
    expect(text(await join(server.endpoints()))).toBe('old')
  })

  it('edits on once the restore lands, before its row and notice come back', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    const token = server.fence(120_000)
    await vi.advanceTimersByTimeAsync(200)
    server.realtime.publishing = false

    await room.restore(token, becomes(room, 'old'))
    const canWrite = room.canWrite
    type(room, ' new')
    await room.flush()

    expect([canWrite, room.stopped]).toEqual([true, null])
    expect(text(await join(server.endpoints()))).toBe('old new')
  })

  it('keeps editing locked until the server answers the restore', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())
    const token = server.fence(120_000)
    server.access.online = false

    const restoring = room.restore(token, becomes(room, 'old'))
    await vi.advanceTimersByTimeAsync(0)
    const lockedWhileSending = [room.restoring, room.canWrite]
    server.access.online = true
    await vi.advanceTimersByTimeAsync(30_000)
    await restoring

    expect([...lockedWhileSending, room.restoring, room.canWrite]).toEqual([
      true,
      false,
      false,
      true,
    ])
  })

  it('a change made while the restore is on its way never rides in it and is kept as a copy', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    const token = server.fence(120_000)
    server.access.online = false

    const restoring = room.restore(token, becomes(room, 'old'))
    await vi.advanceTimersByTimeAsync(0)
    type(room, ' stray')
    server.access.online = true
    await vi.advanceTimersByTimeAsync(30_000)

    expect([await restoring, room.stopped, await reasonsKept(kept)]).toEqual([
      'landed',
      'restored',
      ['restored'],
    ])
    expect(text(await join(server.endpoints()))).toBe('old')
  })

  it('a restore the fence no longer holds changes nothing, keeps no copy and rebuilds the tab', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    const token = server.fence(120_000)
    server.fence(null)

    const outcome = await room.restore(token, becomes(room, 'old'))

    expect([outcome, room.stopped, room.needsRebuild, room.unsent]).toEqual([
      'refused',
      'restore_lost',
      true,
      0,
    ])
    expect(await reasonsKept(kept)).toEqual([])
    expect(text(await join(server.endpoints()))).toBe('draft')
  })

  it('a restore the server refuses for another reason is never kept as a recovery copy', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    const token = server.fence(120_000)
    server.access.refuse = reply(409, { collab: 'poison' })

    const outcome = await room.restore(token, becomes(room, 'old'))

    expect([outcome, room.stopped, await reasonsKept(kept)]).toEqual(['refused', 'poison', []])
  })

  it('a tab closing before its restore is sent leaves nothing on the device to send later', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    const token = server.fence(120_000)
    server.access.online = false

    void room.restore(token, becomes(room, 'old'))
    await vi.advanceTimersByTimeAsync(0)
    await room.close()
    server.access.online = true
    server.fence(null)
    const next = await join(server.endpoints(), { device: kept })
    await next.flush()

    expect([text(next), next.unsent, await reasonsKept(kept)]).toEqual(['draft', 0, []])
    expect(text(await join(server.endpoints()))).toBe('draft')
  })

  it('work still unsent stops a restore before it changes anything', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())
    const token = server.fence(120_000)
    type(room, ' mine')

    const outcome = await room.restore(token, becomes(room, 'old'))

    expect([outcome, text(room)]).toEqual(['unsent', 'draft mine'])
  })

  it('a restore to what the document already holds sends nothing', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())
    const token = server.fence(120_000)

    const outcome = await room.restore(token, () => {})

    expect([outcome, server.rows.length, room.restoring]).toEqual(['unchanged', 1, false])
  })
})

describe('restoring a version', () => {
  function restoreCalls(server: FakeServer) {
    return server.calls.filter((call) => call.includes('Restore'))
  }

  it('fences at the head, sends the restore and leaves no fence behind', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())

    const result = await room.restoreVersion(3, becomes(room, 'old'))

    expect([result, restoreCalls(server)]).toEqual([{ outcome: 'landed' }, ['beginRestore 1 3']])
    expect([room.canWrite, text(await join(server.endpoints()))]).toEqual([true, 'old'])
  })

  it('a tab missing rows pulls them and begins again', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())
    const other = await join(server.endpoints())
    type(other, ' more')
    await other.flush()

    const result = await room.restoreVersion(3, becomes(room, 'old'))

    expect([result.outcome, restoreCalls(server)]).toEqual([
      'landed',
      ['beginRestore 1 3', 'beginRestore 2 3'],
    ])
    expect(text(await join(server.endpoints()))).toBe('old')
  })

  it('a refused begin changes nothing and says why', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())
    server.fence(120_000)

    const result = await room.restoreVersion(3, becomes(room, 'old'))

    expect([result, text(room), room.unsent]).toEqual([
      { outcome: 'refused', refusal: 'restoring', retryS: undefined },
      'draft',
      0,
    ])
  })

  it('a restore that changes nothing calls its fence off', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())

    const result = await room.restoreVersion(3, () => {})
    await vi.advanceTimersByTimeAsync(0)
    type(room, ' after')
    await room.flush()

    expect([result.outcome, restoreCalls(server).at(-1)]).toEqual(['unchanged', 'cancelRestore'])
    expect(text(await join(server.endpoints()))).toBe('draft after')
  })

  it('an edit that throws calls the fence off and changes nothing', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())

    const restoring = room.restoreVersion(3, () => {
      throw new Error('unreadable')
    })

    await expect(restoring).rejects.toThrow('unreadable')
    expect([restoreCalls(server).at(-1), text(room), room.unsent]).toEqual([
      'cancelRestore',
      'draft',
      0,
    ])
  })

  it('work waiting to go stops it before any fence', async () => {
    fakeTime()
    const server = await serverWith('draft')
    const room = await join(server.endpoints())
    server.access.online = false
    type(room, ' mine')

    const result = await room.restoreVersion(3, becomes(room, 'old'))

    expect([result.outcome, restoreCalls(server)]).toEqual(['unsent', []])
  })
})
