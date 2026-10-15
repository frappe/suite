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
})
