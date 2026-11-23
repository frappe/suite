import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import {
  device,
  fakeLocks,
  fakeServer,
  fakeTime,
  heldPushes,
  idle,
  join,
  offlinePushes,
  reply,
  text,
} from './test-support'

describe('collab room on a device', () => {
  it('typing after a lost right that the device could not keep counts as unsent, and nothing is sent', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const kept = await device()
    const room = await join(endpoints, { device: kept })
    server.access.refuse = reply(403, { collab: 'forbidden' })
    await room.pull()
    kept.store.recover = () =>
      Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))
    const push = vi.spyOn(endpoints, 'push')

    room.doc.getText('t').insert(0, 'late')
    await idle()
    await room.flush()

    expect([
      room.status.blockReason,
      room.status.stopReason,
      room.status.unsentCount,
      room.status.saveState,
    ]).toEqual(['lost_read', 'lost_access', 1, 'failed'])
    window.dispatchEvent(new Event('pagehide'))
    await room.close()
    expect(push).not.toHaveBeenCalled()
  })

  it('typing after a lost right that the device keeps leaves nothing unsent', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(403, { collab: 'forbidden' })
    await room.pull()

    room.doc.getText('t').insert(0, 'late')
    await idle()

    expect([room.status.blockReason, room.status.unsentCount, room.status.saveState]).toEqual([
      'lost_read',
      0,
      'clean',
    ])
  })

  it('a tab shut for a lost right keeps its unsent work as one recovery copy that no later tab takes on', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const endpoints = offlinePushes(server)
      const push = vi.spyOn(endpoints, 'push')
      const room = await join(endpoints, { device: kept })
      room.doc.getText('t').insert(0, 'kept here')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      await Promise.all([room.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])
      push.mockClear()
      await room.close()

      const copies = await kept.store.recovery('D')
      const seen = [
        copies.length,
        copies[0]?.reason,
        room.status.blockReason,
        room.status.keptCopyCount,
      ]
      expect(seen).toEqual([1, 'lost_access', 'lost_edit', 1])
      expect(await kept.store.sessions('D')).toEqual([])
      expect(push).not.toHaveBeenCalled()
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      expect([text(next), next.status.unsentCount]).toEqual(['', 0])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a clean tab shut for a lost right keeps no copy and counts none', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_edit')

    const seen = [
      room.status.blockReason,
      room.status.stopReason,
      room.status.keptCopyCount,
      room.status.saveState,
    ]
    expect(seen).toEqual([null, null, 0, 'clean'])
    expect(await kept.store.recovery('D')).toEqual([])
  })

  it('a clean tab shut for a lost right edits and sends again once access comes back', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_edit')
    expect(room.status.canWrite).toBe(false)
    await room.regainAccess(() => true)
    room.doc.getText('t').insert(0, 'typed again')
    await room.flush()

    expect([room.status.canWrite, room.status.blockReason, server.rows.length]).toEqual([
      true,
      null,
      1,
    ])
  })

  it('a clean tab shut for reading is blocked for it at its next refused pull', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_read')
    server.access.refuse = reply(403, { collab: 'forbidden' })
    await room.pull()

    const seen = [
      room.status.blockReason,
      room.status.canWrite,
      (await kept.store.recovery('D')).length,
    ]
    expect(seen).toEqual(['lost_read', false, 0])
  })

  it('a clean tab takes on no work a closed tab left while it is shut, and sends it once access comes back', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      const second = await join(server.endpoints(), { device: kept })
      await second.loseAccess('lost_edit')
      first.doc.getText('t').insert(0, 'left behind')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      await first.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()
      expect([text(second), server.rows.length]).toEqual(['', 0])

      await second.regainAccess(() => true)
      await idle()
      await second.flush()

      expect([text(second), server.rows.length, second.status.unsentCount]).toEqual([
        'left behind',
        1,
        0,
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab whose access comes back while its last push is on the way edits again once the push lands', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const slow = heldPushes(server)
    const room = await join(slow.endpoints, { device: kept })
    room.doc.getText('t').insert(0, 'on its way')
    await vi.advanceTimersByTimeAsync(0)

    void room.loseAccess('lost_edit')
    slow.release()
    await Promise.all([room.regainAccess(() => true), vi.advanceTimersByTimeAsync(3000)])

    const seen = [room.status.canWrite, room.status.blockReason, server.rows.length]
    expect([...seen, (await kept.store.recovery('D')).length]).toEqual([true, null, 1, 0])
  })

  it('a tab whose access comes back while its last push is on the way stays blocked when the push is refused', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const slow = heldPushes(server)
    const room = await join(slow.endpoints, { device: kept })
    room.doc.getText('t').insert(0, 'refused')
    await vi.advanceTimersByTimeAsync(0)

    void room.loseAccess('lost_edit')
    server.access.refuse = reply(403, { collab: 'forbidden' })
    slow.release()
    await Promise.all([room.regainAccess(() => true), vi.advanceTimersByTimeAsync(3000)])

    const seen = [room.status.canWrite, room.status.blockReason, server.rows.length]
    expect([...seen, (await kept.store.recovery('D')).length]).toEqual([false, 'lost_edit', 0, 1])
  })

  it('a tab being shut for a lost right stops taking edits before the bound ends', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const slow = heldPushes(server)
    const room = await join(slow.endpoints, { device: kept })
    room.doc.getText('t').insert(0, 'on its way')
    await vi.advanceTimersByTimeAsync(0)
    const seen: boolean[] = []
    room.onChange(() => seen.push(room.status.canWrite))

    void room.loseAccess('lost_edit')

    expect(seen).toEqual([false])
    // Lets the shut end so the tab can close
    slow.release()
    await vi.advanceTimersByTimeAsync(3000)
  })

  it('what a tab types while its access comes back mid-push reaches the server and a later tab, in order', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const slow = heldPushes(server)
    const room = await join(slow.endpoints, { device: kept })
    room.doc.getText('t').insert(0, 'sent ')
    await vi.advanceTimersByTimeAsync(0)

    void room.loseAccess('lost_edit')
    room.doc.getText('t').insert(5, 'window ')
    slow.release()
    await Promise.all([room.regainAccess(() => true), vi.advanceTimersByTimeAsync(3000)])
    room.doc.getText('t').insert(12, 'after')
    await room.flush()

    const next = await join(server.endpoints())
    const seen = [text(next), !!next.doc.store.pendingStructs, room.status.unsentCount]
    expect(seen).toEqual(['sent window after', false, 0])
    expect(await kept.store.recovery('D')).toEqual([])
  })

  it('what a shut tab still takes while its access is really gone is kept as one copy and blocks the tab', async () => {
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const room = await join(server.endpoints(), { device: kept })
      room.doc.getText('t').insert(0, 'saved')
      await room.flush()
      await room.loseAccess('lost_edit')

      server.access.refuse = reply(403, { collab: 'forbidden' })
      room.doc.getText('t').insert(5, ' shut')
      await room.flush()
      room.doc.getText('t').insert(10, ' late')
      await idle()

      const copies = await kept.store.recovery('D')
      const readable = new yjs.Doc()
      yjs.applyUpdate(readable, copies[0].state!)
      const seen = [
        copies.length,
        room.status.blockReason,
        server.rows.length,
        readable.getText('t').toString(),
      ]
      expect(seen).toEqual([1, 'lost_edit', 1, 'saved shut late'])
      server.access.refuse = null
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      expect([text(next), next.status.unsentCount]).toEqual(['saved', 0])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a clean tab shut, opened and shut again before the bound ends stays shut', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    server.access.canWrite = false
    void room.loseAccess('lost_edit')
    server.access.canWrite = true
    void room.regainAccess(() => server.access.canWrite)
    server.access.canWrite = false
    await room.loseAccess('lost_edit')
    await idle()

    expect([room.status.canWrite, room.status.blockReason]).toEqual([false, null])
  })

  it('a tab opened without the right to edit stays read-only when access comes back, as the server gave it no session', async () => {
    const server = fakeServer()
    const kept = await device()
    server.access.canWrite = false
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_edit')
    server.access.canWrite = true
    await room.regainAccess(() => true)

    expect([room.status.canWrite, room.status.blockReason]).toEqual([false, null])
  })

  it('a tab shut while it reads the work a closed tab left takes none of it, which stays for a later tab', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      const second = await join(server.endpoints(), { device: kept })
      first.doc.getText('t').insert(0, 'left behind')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      const gate = Promise.withResolvers<void>()
      const sessions = kept.store.sessions.bind(kept.store)
      kept.store.sessions = async (...args) => {
        await gate.promise
        return sessions(...args)
      }

      await first.close()
      await vi.advanceTimersByTimeAsync(60_000)

      await Promise.all([second.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])
      gate.resolve()
      await idle()

      expect([text(second), second.status.unsentCount, server.rows.length]).toEqual(['', 0, 0])
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      expect(text(next)).toBe('left behind')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab that kept its work as a copy stays blocked when access comes back', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const room = await join(offlinePushes(server), { device: kept })
    room.doc.getText('t').insert(0, 'kept here')
    await vi.advanceTimersByTimeAsync(0)

    await Promise.all([room.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])
    await room.regainAccess(() => true)

    expect([room.status.canWrite, room.status.blockReason, room.status.stopReason]).toEqual([
      false,
      'lost_edit',
      'lost_access',
    ])
  })

  it('a clean tab whose access comes back takes on none of the work another shut tab kept as a copy', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      const second = await join(server.endpoints(), { device: kept })
      first.doc.getText('t').insert(0, 'kept here')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      void first.loseAccess('lost_edit')
      await Promise.all([second.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])
      await idle()
      await second.regainAccess(() => true)
      await first.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()
      await second.flush()

      const seen = [text(second), server.rows.length, second.status.canWrite]
      expect([...seen, (await kept.store.recovery('D')).length]).toEqual(['', 0, true, 1])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab shut for a lost right sends what the server still takes within the bound, and keeps no copy', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    room.doc.getText('t').insert(0, 'sent in time')

    await room.loseAccess('lost_edit')

    expect([server.rows.length, room.status.unsentCount, room.status.keptCopyCount]).toEqual([
      1, 0, 0,
    ])
    expect(await kept.store.recovery('D')).toEqual([])
  })

  it('a tab shut for a lost right keeps the work it took on from a closed tab in the same copy', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      first.doc.getText('t').insert(0, 'left behind')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      await first.close()
      const second = await join(offlinePushes(server), { device: kept })
      await idle()
      second.doc.getText('t').insert(0, 'typed here ')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      await Promise.all([second.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])

      const copies = await kept.store.recovery('D')
      const aside = new yjs.Doc()
      for (const entry of copies[0].entries) {
        yjs.applyUpdate(aside, entry.bytes)
      }

      expect([copies.length, aside.getText('t').toString()]).toEqual([1, 'typed here left behind'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a push still on its way when the bound ends may land after the copy, so its work is both saved and kept', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const slow = heldPushes(server)
    const room = await join(slow.endpoints, { device: kept })
    room.doc.getText('t').insert(0, 'on its way')
    await vi.advanceTimersByTimeAsync(0)

    await Promise.all([room.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])
    slow.release()
    await idle()

    expect([server.rows.length, (await kept.store.recovery('D')).length]).toEqual([1, 1])
  })

  it('a retry the bound cut off sends nothing once the work is kept as a copy', async () => {
    fakeTime()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      const server = fakeServer()
      const kept = await device()
      const endpoints = offlinePushes(server)
      const push = vi.spyOn(endpoints, 'push')
      const room = await join(endpoints, { device: kept })
      room.doc.getText('t').insert(0, 'retried')
      await vi.advanceTimersByTimeAsync(0)

      await Promise.all([room.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])
      expect(push).toHaveBeenCalledTimes(1)
      push.mockClear()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(push).not.toHaveBeenCalled()
      expect((await kept.store.recovery('D')).length).toBe(1)
    } finally {
      vi.mocked(Math.random).mockRestore()
    }
  })

  it('a tab shut for a lost right whose copy the device could not write says so', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const room = await join(offlinePushes(server), { device: kept })
    kept.store.recover = () =>
      Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))
    room.doc.getText('t').insert(0, 'not kept')
    await vi.advanceTimersByTimeAsync(0)

    await Promise.all([room.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])

    expect([room.status.hasCopyFailed, room.status.keptCopyCount, room.status.saveState]).toEqual([
      true,
      0,
      'failed',
    ])
  })

  it('closing a tab while it is shut for a lost right waits, sends no keepalive and leaves nothing for a later tab', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const endpoints = offlinePushes(server)
      const push = vi.spyOn(endpoints, 'push')
      const room = await join(endpoints, { device: kept })
      room.doc.getText('t').insert(0, 'kept here')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      void room.loseAccess('lost_edit')
      push.mockClear()
      await Promise.all([room.close(), vi.advanceTimersByTimeAsync(3000)])

      expect(push.mock.calls.some(([, request]) => request?.keepalive)).toBe(false)
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      expect([text(next), (await kept.store.recovery('D')).length]).toEqual(['', 1])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab shut for a lost right holds its work until the copy is written, so a tab opened meanwhile takes none of it', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const room = await join(offlinePushes(server), { device: kept })
      const gate = Promise.withResolvers<void>()
      const recover = kept.store.recover.bind(kept.store)
      kept.store.recover = async (...args) => {
        await gate.promise
        return recover(...args)
      }

      room.doc.getText('t').insert(0, 'kept here')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      void room.loseAccess('lost_edit')
      await vi.advanceTimersByTimeAsync(3000)
      void room.close()
      await idle()
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      gate.resolve()
      await idle()

      expect([text(next), (await kept.store.recovery('D')).length]).toEqual(['', 1])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab being shut for a lost right takes on no work another tab leaves meanwhile, which stays for a later tab', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      const second = await join(offlinePushes(server), { device: kept })
      first.doc.getText('t').insert(0, 'left behind')
      second.doc.getText('t').insert(0, 'kept here')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      void second.loseAccess('lost_edit')
      await first.close()
      await idle()
      await vi.advanceTimersByTimeAsync(3000)
      await idle()

      const copies = await kept.store.recovery('D')
      const aside = new yjs.Doc()
      for (const entry of copies[0].entries) {
        yjs.applyUpdate(aside, entry.bytes)
      }

      expect([copies.length, aside.getText('t').toString()]).toEqual([1, 'kept here'])
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      expect(text(next)).toBe('left behind')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab that loses reading access while being shut for editing ends blocked for reading, with one copy', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const room = await join(offlinePushes(server), { device: kept })
    room.doc.getText('t').insert(0, 'kept here')
    await vi.advanceTimersByTimeAsync(0)

    void room.loseAccess('lost_edit')
    await Promise.all([room.loseAccess('lost_read'), vi.advanceTimersByTimeAsync(3000)])

    const seen = [
      room.status.blockReason,
      (await kept.store.recovery('D')).length,
      room.status.keptCopyCount,
    ]
    expect(seen).toEqual(['lost_read', 1, 1])
  })

  it('a tab that loses reading access and then editing access while being shut stays blocked for reading, with one copy', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const room = await join(offlinePushes(server), { device: kept })
    room.doc.getText('t').insert(0, 'kept here')
    await vi.advanceTimersByTimeAsync(0)

    void room.loseAccess('lost_read')
    await Promise.all([room.loseAccess('lost_edit'), vi.advanceTimersByTimeAsync(3000)])

    const seen = [
      room.status.blockReason,
      (await kept.store.recovery('D')).length,
      room.status.keptCopyCount,
    ]
    expect(seen).toEqual(['lost_read', 1, 1])
  })
})
