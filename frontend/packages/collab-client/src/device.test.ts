import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { Device } from './device'
import {
  breaksOn,
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
import type { CollabEndpoints } from './types'

describe('collab room on a device', () => {
  it('work not yet sent when the tab closed shows in the next tab and is committed once', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const first = await join(server.endpoints(), { device: kept })
    server.access.online = false

    first.doc.getText('t').insert(0, 'offline work')
    await vi.advanceTimersByTimeAsync(0)
    await first.close()
    server.access.online = true
    const next = await join(server.endpoints(), { device: kept })
    expect([text(next), next.onDevice]).toEqual(['offline work', true])
    await next.flush()

    expect([server.rows.length, next.saveState, next.unsent]).toEqual([1, 'clean', 0])
    expect(text(await join(server.endpoints()))).toBe('offline work')
  })

  it('a tab still open when another tab tidied the device keeps what it types offline next', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const first = await join(server.endpoints(), { device: kept })
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false

    first.doc.getText('t').insert(0, 'typed in first')
    await vi.advanceTimersByTimeAsync(0)
    await first.close()
    server.access.online = true
    const next = await join(server.endpoints(), { device: kept })
    await next.flush()

    expect([text(next), server.rows.length]).toEqual(['typed in first', 1])
  })

  it('without Web Locks, a tab that sends an offline tab’s work leaves what it typed meanwhile for the next tab', async () => {
    fakeTime()
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    try {
      const server = fakeServer()
      const kept = await device()
      const cut = { off: false }
      const offline = { ...server.endpoints() }
      const reachable = offline.push
      offline.push = async (body, request) => {
        if (cut.off) throw new TypeError('Failed to fetch')
        return reachable(body, request)
      }
      let release = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const slow = { ...server.endpoints() }
      const push = slow.push
      slow.push = async (body, request) => {
        await held
        return push(body, request)
      }
      const first = await join(offline, { device: kept })
      cut.off = true
      first.doc.getText('t').insert(0, 'one')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      const second = await join(slow, { device: kept })
      await vi.advanceTimersByTimeAsync(0)
      first.doc.getText('t').insert(3, ' two')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      release()
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      await second.close()
      await first.close()
      await idle()

      const next = await join(server.endpoints(), { device: kept })
      await next.flush()
      expect(text(await join(server.endpoints()))).toBe('one two')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab opened without the network edits its device copy, then claims, sends, and only then shows others', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const before = await join(server.endpoints(), { device: kept })
    before.doc.getText('t').insert(0, 'base')
    await before.flush()
    await before.close()
    const other = await join(server.endpoints())
    other.doc.getText('t').insert(4, ' other')
    await other.flush()
    server.access.online = false

    const offline = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    offline.doc.getText('t').insert(0, 'mine ')
    await vi.advanceTimersByTimeAsync(0)
    expect([text(offline), offline.canWrite, offline.unsent]).toEqual(['mine base', true, 1])
    expect(offline.doc.clientID).toBeGreaterThanOrEqual(2 ** 30)
    server.calls.length = 0
    server.access.online = true
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await idle()

    expect(server.calls.slice(0, 3)).toEqual(['claim', 'push', 'pull'])
    expect([text(offline), offline.saveState, server.rows.length]).toEqual([
      'mine base other',
      'clean',
      3,
    ])
  })

  it('a claim that clashes keeps the offline work as a recovery copy and sends none of it', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false
    const offline = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    offline.doc.getText('t').insert(0, 'mine')
    await vi.advanceTimersByTimeAsync(0)
    server.sessions.set('taken', { cid: offline.doc.clientID, acked: 0, shas: [] })

    server.access.online = true
    await vi.advanceTimersByTimeAsync(1000)

    const [record] = await kept.store.recovery('D')
    expect([offline.saveState, offline.canWrite, server.rows.length]).toEqual(['failed', false, 0])
    expect([record.reason, record.entries.length]).toEqual(['id_clash', 1])
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('')
  })

  it('a closed tab’s work refused to the next tab is kept as a copy that reads with the text it was typed on', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const first = await join(server.endpoints(), { device: kept })
    first.doc.getText('t').insert(0, 'base')
    await first.flush()
    await first.close()
    server.access.online = false
    const offline = await join(server.endpoints(), { device: kept })
    offline.doc.getText('t').insert(4, ' mine')
    await vi.advanceTimersByTimeAsync(0)
    await offline.close()
    server.sessions.set('taken', { cid: offline.doc.clientID, acked: 0, shas: [] })

    server.access.online = true
    await join(server.endpoints(), { device: kept })
    await idle()

    const [record] = await kept.store.recovery('D')
    const readable = new Y.Doc()
    Y.applyUpdate(readable, record.state!)
    expect([record.reason, readable.getText('t').toString()]).toEqual(['id_clash', 'base mine'])
  })

  it('a clash keeps only the clashing tab’s work aside; another tab’s unsent work is still committed', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const earlier = await join(server.endpoints(), { device: kept })
    server.access.online = false
    earlier.doc.getText('t').insert(0, 'earlier')
    await vi.advanceTimersByTimeAsync(0)
    await earlier.close()
    const offline = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    offline.doc.getText('t').insert(0, 'mine ')
    await vi.advanceTimersByTimeAsync(0)
    server.sessions.set('taken', { cid: offline.doc.clientID, acked: 0, shas: [] })

    server.access.online = true
    await vi.advanceTimersByTimeAsync(1000)
    await offline.close()
    const next = await join(server.endpoints(), { device: kept })
    await next.flush()

    const records = await kept.store.recovery('D')
    expect(records.map((record) => [record.reason, record.entries.length])).toEqual([
      ['id_clash', 1],
    ])
    expect([text(next), server.rows.length]).toEqual(['earlier', 1])
  })

  it('a viewer opened without the network catches up once back', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    server.access.canWrite = false
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false
    const viewer = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    server.access.online = true
    server.access.canWrite = true
    const writer = await join(server.endpoints())

    writer.doc.getText('t').insert(0, 'new')
    await writer.flush()
    await vi.advanceTimersByTimeAsync(1000)

    expect([text(viewer), viewer.blocked, viewer.canWrite]).toEqual(['new', null, false])
  })

  it('a device that cannot keep a session opens nothing offline rather than retrying forever', async () => {
    const server = fakeServer()
    const kept = await device()
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false
    const fullStore = Object.create(kept.store)
    fullStore.saveSession = () => Promise.reject(new DOMException('full', 'QuotaExceededError'))

    await expect(
      join(server.endpoints(), { device: { store: fullStore, doc: 'D' } }),
    ).rejects.toThrow('Failed to fetch')
  })

  it('a tab closed while its claim is answered takes on no other tab’s work', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false
    const left = await join(server.endpoints(), { device: kept })
    left.doc.getText('t').insert(0, 'left')
    await vi.advanceTimersByTimeAsync(0)
    await left.close()
    let answer = () => {}
    const answered = new Promise<void>((resolve) => (answer = resolve))
    const endpoints = server.endpoints()
    const slow: CollabEndpoints = {
      ...endpoints,
      session: (sid, claim) => answered.then(() => endpoints.session(sid, claim)),
    }
    const room = await join(slow, { device: kept, pollMs: 1000 })
    server.access.online = true
    await vi.advanceTimersByTimeAsync(1000)

    server.calls.length = 0
    await room.close()
    answer()
    await idle()

    expect(server.calls).toEqual(['claim'])
  })

  it('a claim the server refuses for good keeps the offline work aside instead of asking again', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false
    const endpoints = server.endpoints()
    const refusing: CollabEndpoints = {
      ...endpoints,
      session: async (sid, claim) => (
        await endpoints.session(sid, claim),
        reply(409, { collab: 'session_owner' })
      ),
    }
    const room = await join(refusing, { device: kept, pollMs: 1000 })
    room.doc.getText('t').insert(0, 'mine')
    await vi.advanceTimersByTimeAsync(0)
    server.calls.length = 0

    server.access.online = true
    await vi.advanceTimersByTimeAsync(1000)
    await idle()
    await vi.advanceTimersByTimeAsync(1000)

    const records = await kept.store.recovery('D')
    expect([room.saveState, server.calls.filter((call) => call === 'claim').length]).toEqual([
      'failed',
      1,
    ])
    expect(records.map((record) => record.reason)).toEqual(['session_owner'])
  })

  it('typing that lands after the server refused a change is kept aside too', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'seq_conflict' })
    room.doc.getText('t').insert(0, 'refused')
    await room.flush()

    room.doc.getText('t').insert(7, ' late')
    await idle()

    const entries = (await kept.store.recovery('D')).flatMap((record) => record.entries)
    const aside = new Y.Doc()
    for (const entry of entries) Y.applyUpdate(aside, entry.bytes)
    expect(aside.getText('t').toString()).toBe('refused late')
  })

  it('a refused change goes to the device’s recovery copies, not back into the next tab', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'seq_conflict' })

    room.doc.getText('t').insert(0, 'refused')
    await room.flush()
    server.access.refuse = null

    expect([room.saveState, (await kept.store.recovery('D'))[0]?.reason]).toEqual([
      'failed',
      'seq_conflict',
    ])
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('')
  })

  it('a refused tab keeps one copy that reads as the whole document under its title, late typing included', async () => {
    const server = fakeServer()
    const kept = { ...(await device()), title: () => 'Plan' }
    const room = await join(server.endpoints(), { device: kept })
    room.doc.getText('t').insert(0, 'saved')
    await room.flush()
    server.access.refuse = reply(409, { collab: 'seq_conflict' })

    room.doc.getText('t').insert(5, ' refused')
    await room.flush()
    room.doc.getText('t').insert(13, ' late')
    await idle()

    const copies = await kept.store.recovery('D')
    const readable = new Y.Doc()
    Y.applyUpdate(readable, copies[0].state!)
    expect([copies.length, copies[0].title, readable.getText('t').toString()]).toEqual([
      1,
      'Plan',
      'saved refused late',
    ])
    expect(room.copiesKept).toBe(2)
  })

  it('a change on the device reaches every listener in another tab, until one stops listening', async () => {
    const kept = await device()
    const writer = new Device(kept)
    const reader = new Device(kept)
    const heard: string[] = []
    reader.onChanged(() => heard.push('room'))
    const stop = reader.onChanged(() => heard.push('second'))

    writer.changed()
    await vi.waitFor(() => expect(heard).toEqual(['room', 'second']))
    stop()
    writer.changed()
    await vi.waitFor(() => expect(heard).toEqual(['room', 'second', 'room']))
    writer.close()
    reader.close()
  })

  it('a recovery copy the device could not write is never counted as kept', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    kept.store.recover = () =>
      Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))
    server.access.refuse = reply(409, { collab: 'seq_conflict' })

    room.doc.getText('t').insert(0, 'refused')
    await room.flush()
    await idle()

    expect([room.saveState, room.copiesKept, room.copyFailed]).toEqual(['failed', 0, true])
  })

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

    expect([room.blocked, room.stopped, room.unsent, room.saveState]).toEqual([
      'lost_read',
      'lost_access',
      1,
      'failed',
    ])
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

    expect([room.blocked, room.unsent, room.saveState]).toEqual(['lost_read', 0, 'clean'])
  })

  it('a change from a session the server closed is kept aside and the tab asks to be rebuilt', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'client_closed' })

    room.doc.getText('t').insert(0, 'after the quarantine')
    await room.flush()

    expect([room.stopped, room.needsRebuild, room.saveState]).toEqual([
      'client_closed',
      true,
      'failed',
    ])
    expect((await kept.store.recovery('D')).map((copy) => copy.reason)).toEqual(['client_closed'])
  })

  it('a tab told collaboration is off keeps its unsent work as a recovery copy and stops', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'disabled' })

    room.doc.getText('t').insert(0, 'typed before the switch')
    await room.flush()

    expect([room.stopped, room.saveState, room.canWrite]).toEqual(['disabled', 'failed', false])
    expect((await kept.store.recovery('D')).map((copy) => copy.reason)).toEqual(['disabled'])
  })

  it('a tab with nothing unsent stops once a pull says collaboration is off', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(409, { collab: 'disabled' })

    await room.pull()

    expect([room.stopped, room.canWrite]).toEqual(['disabled', false])
  })

  it('a tab whose suspect report is answered that collaboration is off stops', async () => {
    const server = fakeServer('live', 'apply-1')
    server.judge.answer = () => reply(409, { collab: 'disabled' })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()

    await vi.waitFor(() =>
      expect([server.judge.reports, room.stopped, room.canWrite]).toEqual([[1], 'disabled', false]),
    )
  })

  it('a change refused by a full document is kept aside and the tab asks to be rebuilt', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(423, { collab: 'doc_full', retry_ms: 300_000 })

    room.doc.getText('t').insert(0, 'one line too many')
    await room.flush()
    server.access.refuse = null

    expect([room.stopped, room.needsRebuild, room.paused]).toEqual(['document_full', true, null])
    expect((await kept.store.recovery('D')).map((copy) => copy.reason)).toEqual(['document_full'])
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('')
  })

  it('a tab knows the document is at its limit from the open, and that it has room again from a pull', async () => {
    const server = fakeServer()
    server.counted.state = 4 * 2 ** 20
    const room = await join(server.endpoints())
    const opened = room.atLimit
    let changeCount = 0
    room.onChange(() => changeCount++)

    server.counted.state = null
    await room.pull()

    expect([opened, room.atLimit, changeCount > 0]).toEqual([true, false, true])
  })

  it('a document is at its limit once its saved changes fill what its state leaves', async () => {
    const server = fakeServer()
    server.counted.state = 4 * 2 ** 20 - 10
    const room = await join(server.endpoints())
    const opened = room.atLimit
    room.doc.getText('t').insert(0, 'more than ten bytes')
    await room.flush()
    await room.pull()

    expect([opened, room.atLimit]).toEqual([false, true])
  })

  it('a rebuild leaves no quarantined change in the device copy', async () => {
    const server = fakeServer()
    const kept = await device()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'one ')
    await writer.flush()
    const reader = await join(server.endpoints(), { device: kept })
    writer.doc.getText('t').insert(4, 'bad')
    await writer.flush()
    await reader.pull()
    expect(text(reader)).toBe('one bad')
    server.quarantine(2)
    await reader.pull()
    await reader.close()

    expect(text(await join(server.endpoints(), { device: kept }))).toBe('one ')
    server.access.online = false
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('one ')
  })

  it('work left from before the document was replaced is kept as a recovery copy, not applied', async () => {
    const server = fakeServer()
    const kept = await device()
    const stale = new Y.Doc()
    let bytes: Uint8Array = new Uint8Array()
    stale.on('update', (update: Uint8Array) => (bytes = update))
    stale.getText('t').insert(0, 'old')
    const old = { doc: 'D', sid: 'old', lineage: 'GONE', cid: 99, bound: true }
    await kept.store.capture(old, [{ doc: 'D', sid: 'old', seq: 1, bytes, sha: 'x', seenRev: 0 }])

    const room = await join(server.endpoints(), { device: kept })

    expect([text(room), room.unsent, (await kept.store.recovery('D'))[0]?.reason]).toEqual([
      '',
      0,
      'lineage',
    ])
  })

  it('without a device store the tab stops editing while offline and resumes once back', async () => {
    fakeTime()
    const server = fakeServer()
    const room = await join(server.endpoints(), { pollMs: 1000 })
    room.doc.getText('t').insert(0, 'held')
    server.access.online = false

    await vi.advanceTimersByTimeAsync(1000)
    expect([room.blocked, room.unsent, room.onDevice]).toEqual(['offline', 1, false])
    server.access.online = true
    await vi.advanceTimersByTimeAsync(31_000)

    expect([room.blocked, room.saveState, server.rows.length]).toEqual([null, 'clean', 1])
  })

  it('work held offline is sent on the first poll that reaches the server, not after a long retry wait', async () => {
    fakeTime()
    const server = fakeServer()
    const room = await join(server.endpoints(), { device: await device(), pollMs: 2000 })
    server.access.online = false
    room.doc.getText('t').insert(0, 'typed offline')
    await vi.advanceTimersByTimeAsync(0)
    expect(room.unsent).toBe(1)

    vi.spyOn(Math, 'random').mockReturnValue(1)
    try {
      await vi.advanceTimersByTimeAsync(2000)
      server.access.online = true
      await vi.advanceTimersByTimeAsync(2000)
    } finally {
      vi.mocked(Math.random).mockRestore()
    }

    expect([room.unsent, room.saveState, server.rows.length]).toEqual([0, 'clean', 1])
  })

  it('asks the browser to keep this site’s data once unsent work is held offline', async () => {
    fakeTime()
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { ...navigator, storage: { persist } })
    try {
      const server = fakeServer()
      const room = await join(server.endpoints(), { device: await device() })
      await vi.advanceTimersByTimeAsync(0)
      expect(persist).not.toHaveBeenCalled()
      server.access.online = false

      room.doc.getText('t').insert(0, 'held')
      await vi.advanceTimersByTimeAsync(0)

      expect([persist.mock.calls.length, room.blocked]).toEqual([1, null])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a tab counts the work another open tab holds as unsent, and shows Saved once it is committed', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const slow = heldPushes(server)
      const first = await join(slow.endpoints, { device: kept })
      first.doc.getText('t').insert(0, 'held in first')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      const second = await join(server.endpoints(), { device: kept })
      await idle()
      const seen = [second.unsent, second.othersUnsent, second.saveState, text(second)]
      expect(seen).toEqual([0, 1, 'unsaved', ''])

      slow.release()
      await first.flush()
      await idle()
      expect([second.othersUnsent, second.saveState, first.saveState]).toEqual([
        0,
        'clean',
        'clean',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('work an open tab held when it closed is sent once by the tab still open', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      first.doc.getText('t').insert(0, 'left behind')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      const second = await join(server.endpoints(), { device: kept })
      await idle()

      await first.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()
      await second.flush()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()

      const seen = [text(second), server.rows.length, second.othersUnsent, second.saveState]
      expect(seen).toEqual(['left behind', 1, 0, 'clean'])
    } finally {
      vi.unstubAllGlobals()
    }
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
      const seen = [copies.length, copies[0]?.reason, room.blocked, room.copiesKept]
      expect(seen).toEqual([1, 'lost_access', 'lost_edit', 1])
      expect(await kept.store.sessions('D')).toEqual([])
      expect(push).not.toHaveBeenCalled()
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      expect([text(next), next.unsent]).toEqual(['', 0])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a clean tab shut for a lost right keeps no copy and counts none', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_edit')

    const seen = [room.blocked, room.stopped, room.copiesKept, room.saveState]
    expect(seen).toEqual([null, null, 0, 'clean'])
    expect(await kept.store.recovery('D')).toEqual([])
  })

  it('a clean tab shut for a lost right edits and sends again once access comes back', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_edit')
    expect(room.canWrite).toBe(false)
    await room.regainAccess(() => true)
    room.doc.getText('t').insert(0, 'typed again')
    await room.flush()

    expect([room.canWrite, room.blocked, server.rows.length]).toEqual([true, null, 1])
  })

  it('a clean tab shut for reading is blocked for it at its next refused pull', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_read')
    server.access.refuse = reply(403, { collab: 'forbidden' })
    await room.pull()

    const seen = [room.blocked, room.canWrite, (await kept.store.recovery('D')).length]
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

      expect([text(second), server.rows.length, second.unsent]).toEqual(['left behind', 1, 0])
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

    const seen = [room.canWrite, room.blocked, server.rows.length]
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

    const seen = [room.canWrite, room.blocked, server.rows.length]
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
    room.onChange(() => seen.push(room.canWrite))

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
    const seen = [text(next), !!next.doc.store.pendingStructs, room.unsent]
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
      const readable = new Y.Doc()
      Y.applyUpdate(readable, copies[0].state!)
      const seen = [
        copies.length,
        room.blocked,
        server.rows.length,
        readable.getText('t').toString(),
      ]
      expect(seen).toEqual([1, 'lost_edit', 1, 'saved shut late'])
      server.access.refuse = null
      const next = await join(server.endpoints(), { device: kept })
      await idle()
      expect([text(next), next.unsent]).toEqual(['saved', 0])
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

    expect([room.canWrite, room.blocked]).toEqual([false, null])
  })

  it('a tab opened without the right to edit stays read-only when access comes back, as the server gave it no session', async () => {
    const server = fakeServer()
    const kept = await device()
    server.access.canWrite = false
    const room = await join(server.endpoints(), { device: kept })

    await room.loseAccess('lost_edit')
    server.access.canWrite = true
    await room.regainAccess(() => true)

    expect([room.canWrite, room.blocked]).toEqual([false, null])
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

      expect([text(second), second.unsent, server.rows.length]).toEqual(['', 0, 0])
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

    expect([room.canWrite, room.blocked, room.stopped]).toEqual([false, 'lost_edit', 'lost_access'])
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

      const seen = [text(second), server.rows.length, second.canWrite]
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

    expect([server.rows.length, room.unsent, room.copiesKept]).toEqual([1, 0, 0])
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
      const aside = new Y.Doc()
      for (const entry of copies[0].entries) {
        Y.applyUpdate(aside, entry.bytes)
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

    expect([room.copyFailed, room.copiesKept, room.saveState]).toEqual([true, 0, 'failed'])
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
      const aside = new Y.Doc()
      for (const entry of copies[0].entries) {
        Y.applyUpdate(aside, entry.bytes)
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

    const seen = [room.blocked, (await kept.store.recovery('D')).length, room.copiesKept]
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

    const seen = [room.blocked, (await kept.store.recovery('D')).length, room.copiesKept]
    expect(seen).toEqual(['lost_read', 1, 1])
  })
})
