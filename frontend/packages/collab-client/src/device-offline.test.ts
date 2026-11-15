import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import type { RecoveryRecord } from './store'
import {
  device,
  fakeLocks,
  fakeServer,
  fakeTime,
  idle,
  join,
  reply,
  text,
  type FakeServer,
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
    expect([text(next), next.status.isKeptOnDevice]).toEqual(['offline work', true])
    await next.flush()

    expect([server.rows.length, next.status.saveState, next.status.unsentCount]).toEqual([
      1,
      'clean',
      0,
    ])
    expect(text(await join(server.endpoints()))).toBe('offline work')
  })

  it('a tab counts the work it took on from a closed tab as its own, after sending it too', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const first = await join(server.endpoints(), { device: kept })
    const firstClient = first.doc.clientID
    server.access.online = false

    first.doc.getText('t').insert(0, 'offline work')
    await vi.advanceTimersByTimeAsync(0)
    await first.close()
    server.access.online = true
    const next = await join(server.endpoints(), { device: kept })
    await next.flush()

    expect(next.status.unsentCount).toBe(0)
    expect(next.ownClients).toEqual(new Set([next.doc.clientID, firstClient]))
    expect(next.doc.clientID).not.toBe(firstClient)
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
        if (cut.off) {
          throw new TypeError('Failed to fetch')
        }

        return reachable(body, request)
      }

      const { promise: held, resolve: release } = Promise.withResolvers<void>()
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
    expect([text(offline), offline.status.canWrite, offline.status.unsentCount]).toEqual([
      'mine base',
      true,
      1,
    ])
    expect(offline.doc.clientID).toBeGreaterThanOrEqual(2 ** 30)
    server.calls.length = 0
    server.access.online = true
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await idle()

    expect(server.calls.slice(0, 3)).toEqual(['claim', 'push', 'pull'])
    expect([text(offline), offline.status.saveState, server.rows.length]).toEqual([
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
    expect([offline.status.saveState, offline.status.canWrite, server.rows.length]).toEqual([
      'failed',
      false,
      0,
    ])
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
    const readable = new yjs.Doc()
    yjs.applyUpdate(readable, record.state!)
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

    expect([text(viewer), viewer.status.blockReason, viewer.status.canWrite]).toEqual([
      'new',
      null,
      false,
    ])
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
    const { promise: answered, resolve: answer } = Promise.withResolvers<void>()
    const endpoints = server.endpoints()
    const slow: CollabEndpoints = {
      ...endpoints,
      session: async (sid, claim) => {
        await answered
        return endpoints.session(sid, claim)
      },
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
    expect([room.status.saveState, server.calls.filter((call) => call === 'claim').length]).toEqual(
      ['failed', 1],
    )
    expect(records.map((record) => record.reason)).toEqual(['session_owner'])
  })

  it('without a device store the tab stops editing while offline and resumes once back', async () => {
    fakeTime()
    const server = fakeServer()
    const room = await join(server.endpoints(), { pollMs: 1000 })
    room.doc.getText('t').insert(0, 'held')
    server.access.online = false

    await vi.advanceTimersByTimeAsync(1000)
    expect([room.status.blockReason, room.status.unsentCount, room.status.isKeptOnDevice]).toEqual([
      'offline',
      1,
      false,
    ])
    server.access.online = true
    await vi.advanceTimersByTimeAsync(31_000)

    expect([room.status.blockReason, room.status.saveState, server.rows.length]).toEqual([
      null,
      'clean',
      1,
    ])
  })

  it('work held offline is sent on the first poll that reaches the server, not after a long retry wait', async () => {
    fakeTime()
    const server = fakeServer()
    const room = await join(server.endpoints(), { device: await device(), pollMs: 2000 })
    server.access.online = false
    room.doc.getText('t').insert(0, 'typed offline')
    await vi.advanceTimersByTimeAsync(0)
    expect(room.status.unsentCount).toBe(1)

    vi.spyOn(Math, 'random').mockReturnValue(1)
    try {
      await vi.advanceTimersByTimeAsync(2000)
      server.access.online = true
      await vi.advanceTimersByTimeAsync(2000)
    } finally {
      vi.mocked(Math.random).mockRestore()
    }

    expect([room.status.unsentCount, room.status.saveState, server.rows.length]).toEqual([
      0,
      'clean',
      1,
    ])
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

      expect([persist.mock.calls.length, room.status.blockReason]).toEqual([1, null])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

type Kept = Awaited<ReturnType<typeof device>>

// A device holding the server's copy, with the network then gone
async function offlineDevice(server: FakeServer) {
  const kept = await device()
  await (await join(server.endpoints(), { device: kept })).close()
  server.access.online = false
  return kept
}

// A tab opened offline adds `word` at the end and closes, leaving it unsent; returns its clientID
async function leaveOffline(server: FakeServer, kept: Kept, word: string) {
  const tab = await join(server.endpoints(), { device: kept })
  tab.doc.getText('t').insert(text(tab).length, word)
  await vi.advanceTimersByTimeAsync(0)
  await tab.close()
  return tab.doc.clientID
}

// Back online for three ticks of a 1000 ms poll, the device's writes landing between ticks, counting calls from there
async function reconnect(server: FakeServer) {
  server.calls.length = 0
  server.access.online = true
  for (let tick = 0; tick < 3; tick++) {
    await vi.advanceTimersByTimeAsync(1000)
    await idle()
  }
}

// The `nth` claim made online gets no answer: it never reaches the server, or is taken and its answer lost
function claimsLosing(server: FakeServer, nth: number, reached: boolean): CollabEndpoints {
  const endpoints = server.endpoints()
  let claims = 0
  return {
    ...endpoints,
    session: async (sid, claim) => {
      if (claim && server.access.online && ++claims === nth) {
        if (reached) {
          await endpoints.session(sid, claim)
        }

        throw new TypeError('Failed to fetch')
      }

      return endpoints.session(sid, claim)
    },
  }
}

// Claims made while `lost.on` get no answer: they never reach the server, or are taken with the answer lost
function claimsUnanswered(server: FakeServer, reached: boolean) {
  const endpoints = server.endpoints()
  const lost = { on: true }
  const unanswered: CollabEndpoints = {
    ...endpoints,
    session: async (sid, claim) => {
      if (claim && lost.on) {
        if (reached) {
          await endpoints.session(sid, claim)
        }

        throw new TypeError('Failed to fetch')
      }

      return endpoints.session(sid, claim)
    },
  }
  return { lost, endpoints: unanswered }
}

// What the recovery copy shows opened on its own
function readsAs(record: RecoveryRecord) {
  const readable = new yjs.Doc()
  yjs.applyUpdate(readable, record.state!)
  return readable.getText('t').toString()
}

async function serverText(server: FakeServer) {
  return text(await join(server.endpoints()))
}

function fixtureSession(sid: string, cid: number) {
  return { doc: 'D', sid, lineage: 'L', cid, bound: true }
}

function fixtureEntry(sid: string, seq: number, bytes: Uint8Array) {
  return { doc: 'D', sid, seq, bytes, sha: `${sid}-${seq}`, seenRev: 0 }
}

// The update `word` typed at `index` makes
function typed(doc: yjs.Doc, index: number, word: string) {
  let update = new Uint8Array()
  doc.once('update', (bytes: Uint8Array) => {
    update = bytes
  })
  doc.getText('t').insert(index, word)
  return update
}

describe('a tab taking on another tab’s unsent work', () => {
  it('opened offline shows what an offline tab left, and back online claims both before sending', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    await leaveOffline(server, kept, 'first')
    const next = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    expect(text(next)).toBe('first')
    next.doc.getText('t').insert(5, ' second')
    await vi.advanceTimersByTimeAsync(0)

    await reconnect(server)

    expect(server.calls.slice(0, 4)).toEqual(['claim', 'claim', 'push', 'push'])
    expect([next.status.saveState, server.rows.length]).toEqual(['clean', 2])
    expect(await serverText(server)).toBe('first second')
  })

  it('whose clientID clashes on the server sends nothing and keeps one copy that reads with both tabs’ work', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    const firstClient = await leaveOffline(server, kept, 'first')
    const next = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    next.doc.getText('t').insert(5, ' second')
    await vi.advanceTimersByTimeAsync(0)
    server.sessions.set('taken', { cid: firstClient, acked: 0, shas: [] })

    await reconnect(server)

    const records = await kept.store.recovery('D')
    expect(records.map((record) => [record.reason, readsAs(record)])).toEqual([
      ['id_clash', 'first second'],
    ])
    expect([next.status.saveState, server.calls.includes('push')]).toEqual(['failed', false])
  })

  it('keeps aside only its own work when its own claim clashes, and the next tab sends what it took on', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    await leaveOffline(server, kept, 'first')
    const next = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    next.doc.getText('t').insert(5, ' second')
    await vi.advanceTimersByTimeAsync(0)
    server.sessions.set('taken', { cid: next.doc.clientID, acked: 0, shas: [] })

    await reconnect(server)
    await next.close()
    await (await join(server.endpoints(), { device: kept })).flush()

    const records = await kept.store.recovery('D')
    expect(records.map((record) => [record.reason, record.entries.length])).toEqual([
      ['id_clash', 1],
    ])
    expect(await serverText(server)).toBe('first')
  })

  it('leaves the work of an offline tab still open', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await offlineDevice(server)
      const open = await join(server.endpoints(), { device: kept })
      open.doc.getText('t').insert(0, 'still open')
      await vi.advanceTimersByTimeAsync(0)

      const next = await join(server.endpoints(), { device: kept })

      expect([text(next), next.status.unsentCount]).toEqual(['', 0])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('offline, keeps aside work typed on a history the device copy no longer follows, without showing it', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    await leaveOffline(server, kept, 'first')
    await kept.store.commit('D', { lineage: 'M', rev: 0, canWrite: true, epoch: 0 }, null)

    const next = await join(server.endpoints(), { device: kept })

    const records = await kept.store.recovery('D')
    expect(text(next)).toBe('')
    expect(records.map((record) => [record.reason, readsAs(record)])).toEqual([
      ['lineage', 'first'],
    ])
  })

  it('after three offline reloads shows all of them, and back online sends them in an order the server takes', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    await leaveOffline(server, kept, 'one')
    await leaveOffline(server, kept, ' two')
    const last = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    last.doc.getText('t').insert(7, ' three')
    await vi.advanceTimersByTimeAsync(0)
    expect(text(last)).toBe('one two three')

    await reconnect(server)

    expect([last.status.saveState, last.status.stopReason, server.rows.length]).toEqual([
      'clean',
      null,
      3,
    ])
    expect(await serverText(server)).toBe('one two three')
  })

  it.each([
    ['never reaches the server', 1, false],
    ['is taken with its answer lost', 1, true],
    ['for the second reload is taken with its answer lost', 2, true],
  ])(
    'back online, a claim that %s is asked again and the work is sent once',
    async (_, nth, reached) => {
      fakeTime()
      const server = fakeServer()
      const kept = await offlineDevice(server)
      await leaveOffline(server, kept, 'one')
      await leaveOffline(server, kept, ' two')
      const last = await join(claimsLosing(server, nth, reached), { device: kept, pollMs: 1000 })
      last.doc.getText('t').insert(7, ' three')
      await vi.advanceTimersByTimeAsync(0)

      await reconnect(server)

      expect([last.status.saveState, server.rows.length]).toEqual(['clean', 3])
      expect(await serverText(server)).toBe('one two three')
    },
  )

  it('opened online, keeps a refused offline chain as one copy that reads with both, and goes on working', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    const firstClient = await leaveOffline(server, kept, 'one')
    await leaveOffline(server, kept, ' two')
    server.sessions.set('taken', { cid: firstClient, acked: 0, shas: [] })
    server.access.online = true

    const room = await join(server.endpoints(), { device: kept })

    const records = await kept.store.recovery('D')
    const sessions = await kept.store.sessions('D')
    expect(records.map((record) => [record.reason, readsAs(record)])).toEqual([
      ['id_clash', 'one two'],
    ])
    expect([server.rows.length, sessions.map((session) => session.sid)]).toEqual([
      0,
      [room.ownOutbox.sid],
    ])
    room.doc.getText('t').insert(0, 'later')
    await room.flush()
    expect([room.status.saveState, await serverText(server)]).toEqual(['clean', 'later'])
  })

  it.each([
    ['with Web Locks', true, false],
    ['without Web Locks', false, false],
    ['without Web Locks, the claim taken with its answer lost', false, true],
  ])(
    'opened online, holds an offline chain whose first claim gets no answer, then sends it in order (%s)',
    async (_, locks, reached) => {
      fakeTime()
      if (locks) {
        fakeLocks()
      }

      try {
        const server = fakeServer()
        const kept = await offlineDevice(server)
        const firstClient = await leaveOffline(server, kept, 'one')
        const secondClient = await leaveOffline(server, kept, ' two')
        server.access.online = true
        const { lost, endpoints } = claimsUnanswered(server, reached)

        const room = await join(endpoints, { device: kept, pollMs: 1000 })
        await idle()
        const claimed = [...server.sessions.values()].map((session) => session.cid)
        expect([
          server.rows.length,
          claimed.includes(firstClient),
          claimed.includes(secondClient),
        ]).toEqual([0, reached, false])
        lost.on = false
        await vi.advanceTimersByTimeAsync(1000)
        await idle()
        await room.flush()

        expect([room.status.stopReason, server.rows.length]).toEqual([null, 2])
        expect(await serverText(server)).toBe('one two')
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it('sends an edit on another tab’s saved paragraph while that tab is still open with unsent work', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const cut = { off: false }
      const cutting = { ...server.endpoints() }
      const reachable = cutting.push
      cutting.push = async (body, request) => {
        if (cut.off) {
          throw new TypeError('Failed to fetch')
        }

        return reachable(body, request)
      }

      const typist = await join(cutting, { device: kept })
      typist.doc.getText('t').insert(0, 'para')
      await typist.flush()
      cut.off = true
      server.access.online = false
      typist.doc.getText('t').insert(4, ' more')
      await vi.advanceTimersByTimeAsync(0)
      const editor = await join(server.endpoints(), { device: kept })
      editor.doc.getText('t').delete(0, 2)
      editor.doc.getText('t').insert(0, 'B:')
      await vi.advanceTimersByTimeAsync(0)
      await editor.close()
      server.access.online = true

      await (await join(server.endpoints(), { device: kept })).flush()

      const typistEntries = await kept.store.entries('D', typist.ownOutbox.sid)
      expect([await serverText(server), typistEntries.length]).toEqual(['B:ra', 1])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends an edit on a paragraph whose push committed with its answer lost, while that tab is still open', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const lossy = { ...server.endpoints() }
      const push = lossy.push
      lossy.push = async (body, request) => {
        if (!server.rows.length) {
          await push(body, request)
        }

        throw new TypeError('Failed to fetch')
      }

      const typist = await join(lossy, { device: kept })
      typist.doc.getText('t').insert(0, 'para')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      expect([server.rows.length, typist.status.unsentCount]).toEqual([1, 1])
      const editor = await join(server.endpoints(), { device: kept })
      server.access.online = false
      editor.doc.getText('t').delete(0, 2)
      editor.doc.getText('t').insert(0, 'B:')
      await vi.advanceTimersByTimeAsync(0)
      await editor.close()
      server.access.online = true

      await (await join(server.endpoints(), { device: kept })).flush()

      const typistEntries = await kept.store.entries('D', typist.ownOutbox.sid)
      expect([await serverText(server), typistEntries.length]).toEqual(['B:ra', 1])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends two closed tabs’ deletes of each other’s saved text, holding neither back', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const left = await join(server.endpoints(), { device: kept })
    left.doc.getText('t').insert(0, 'pp')
    await left.flush()
    const right = await join(server.endpoints(), { device: kept })
    right.doc.getText('t').insert(2, 'qq')
    await right.flush()
    await left.pull()
    server.access.online = false
    left.doc.getText('t').delete(2, 2)
    right.doc.getText('t').delete(0, 2)
    await vi.advanceTimersByTimeAsync(0)
    await left.close()
    await right.close()
    server.access.online = true

    const next = await join(server.endpoints(), { device: kept })
    await next.flush()

    const records = await kept.store.recovery('D')
    expect([await serverText(server), next.status.stopReason, records.length]).toEqual([
      '',
      null,
      0,
    ])
  })

  it('keeps two sessions that each need the other’s unsent work as one readable copy, sending neither', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await device()
    const one = new yjs.Doc()
    one.clientID = 101
    const two = new yjs.Doc()
    two.clientID = 102
    const first = typed(one, 0, 'a')
    yjs.applyUpdate(two, first)
    const second = typed(two, 1, 'b')
    yjs.applyUpdate(one, second)
    const third = typed(one, 2, 'c')
    await kept.store.capture(fixtureSession('one', 101), [
      fixtureEntry('one', 1, first),
      fixtureEntry('one', 2, third),
    ])
    await kept.store.capture(fixtureSession('two', 102), [fixtureEntry('two', 1, second)])

    const room = await join(server.endpoints(), { device: kept })

    const records = await kept.store.recovery('D')
    expect(records.map((record) => [record.reason, readsAs(record)])).toEqual([
      ['missing_dep', 'abc'],
    ])
    expect([text(room), server.calls.includes('push'), room.status.stopReason]).toEqual([
      '',
      false,
      null,
    ])
  })

  it('keeps the offline chain as one readable copy when a restore landed meanwhile, committing none of it', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    await leaveOffline(server, kept, 'one')
    const last = await join(server.endpoints(), { device: kept, pollMs: 1000 })
    last.doc.getText('t').insert(3, ' two')
    await vi.advanceTimersByTimeAsync(0)
    const restored = new yjs.Doc()
    restored.getText('t').insert(0, 'restored')
    server.landRestore(yjs.encodeStateAsUpdate(restored))

    await reconnect(server)

    const records = await kept.store.recovery('D')
    expect(records.map((record) => [record.reason, readsAs(record)])).toEqual([
      ['restored', 'one two'],
    ])
    expect(await serverText(server)).toBe('restored')
  })

  it('without Web Locks, two offline tabs that both take on the same work commit it once', async () => {
    fakeTime()
    const server = fakeServer()
    const kept = await offlineDevice(server)
    await leaveOffline(server, kept, 'one')
    const tabs = [
      await join(server.endpoints(), { device: kept, pollMs: 1000 }),
      await join(server.endpoints(), { device: kept, pollMs: 1000 }),
    ]
    expect(tabs.map(text)).toEqual(['one', 'one'])

    await reconnect(server)

    expect(await serverText(server)).toBe('one')
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('one')
  })
})
