import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { CollabOpenError } from './answers'
import { openCollabRoom } from './open'
import { openDeviceStore, type DeviceStore } from './store'
import type { Answer, CollabEndpoints, CollabRoom, OpenOptions } from './types'

const reply = (status: number, body: unknown): Answer => ({
  status,
  bytes: new TextEncoder().encode(JSON.stringify(body)),
})

function frame(
  header: object,
  rows: { rev: number; bytes: Uint8Array }[] = [],
  checkpoint = new Uint8Array(),
): Answer {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const size =
    4 +
    json.length +
    8 +
    checkpoint.length +
    rows.reduce((sum, row) => sum + 12 + row.bytes.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let at = 0
  view.setUint32(at, json.length)
  out.set(json, (at += 4))
  at += json.length
  view.setUint32(at, checkpoint.length)
  out.set(checkpoint, (at += 4))
  at += checkpoint.length
  view.setUint32(at, rows.length)
  at += 4
  for (const row of rows) {
    view.setBigUint64(at, BigInt(row.rev))
    view.setUint32((at += 8), row.bytes.length)
    out.set(row.bytes, (at += 4))
    at += row.bytes.length
  }
  return { status: 200, bytes: out }
}

// The server's rules: one gap-free order, a seq range must continue the session's ack.
// `refuse` answers every request the way the server would for a tab it no longer hears
function fakeServer(state = 'live') {
  const rows: { rev: number; bytes: Uint8Array }[] = []
  const sessions = new Map<string, { cid: number; acked: number; shas: string[] }>()
  const access = { refuse: null as Answer | null, canWrite: true, online: true }
  const calls: string[] = []
  const pulls: number[] = []
  const finals: boolean[] = []
  const schemas: number[] = []
  // Rows through `base` folded into one state, as a compaction leaves them
  const checkpoint = { base: 0, bytes: new Uint8Array() }
  let nextClient = 1
  const reach = (call: string) => {
    if (!access.online) throw new TypeError('Failed to fetch')
    calls.push(call)
  }
  const endpoints = (): CollabEndpoints => ({
    async open() {
      reach('open')
      const tail = state === 'live' ? rows.filter((row) => row.rev > checkpoint.base) : []
      const header = {
        state,
        proto: 1,
        lineage: 'L',
        can_write: access.canWrite,
        base: checkpoint.base,
      }
      return frame(header, tail, checkpoint.bytes)
    },
    async pull(since) {
      reach('pull')
      pulls.push(since)
      if (access.refuse) return access.refuse
      return frame(
        { state, proto: 1 },
        rows.filter((row) => row.rev > since),
      )
    },
    async session(sid, claim) {
      reach(claim ? 'claim' : 'session')
      if (!access.canWrite) return reply(403, { collab: 'forbidden' })
      if (claim) {
        if (claim.lineage !== 'L') return reply(200, { claim: 'lineage' })
        const taken = [...sessions.entries()].some(
          ([other, session]) => other !== sid && session.cid === claim.cid,
        )
        if (taken || (sessions.has(sid) && sessions.get(sid)!.cid !== claim.cid))
          return reply(200, { claim: 'clash' })
        if (!sessions.has(sid)) sessions.set(sid, { cid: claim.cid, acked: 0, shas: [] })
        return reply(200, { claim: 'ok' })
      }
      if (!sessions.has(sid)) sessions.set(sid, { cid: nextClient++, acked: 0, shas: [] })
      return reply(200, { client_id: sessions.get(sid)!.cid })
    },
    async push(body) {
      reach('push')
      if (access.refuse) return access.refuse
      const view = new DataView(body.buffer, body.byteOffset)
      const length = view.getUint32(0)
      const header = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + length)))
      finals.push(header.final)
      schemas.push(header.schema)
      const session = sessions.get(header.sid)
      if (length > 4096 || header.shas?.length !== header.to - header.from + 1)
        return reply(400, { collab: 'malformed' })
      if (!session || session.cid !== header.cid) return reply(409, { collab: 'client_conflict' })
      if (header.from <= session.acked) {
        for (let seq = header.from; seq <= Math.min(header.to, session.acked); seq++) {
          if (session.shas[seq] !== header.shas[seq - header.from])
            return reply(409, { collab: 'seq_conflict' })
        }
        return reply(200, { dup: true, acked: session.acked, head: rows.length })
      }
      if (header.from !== session.acked + 1)
        return reply(409, { collab: 'seq', acked: session.acked })
      header.shas.forEach((sha: string, index: number) => (session.shas[header.from + index] = sha))
      rows.push({ rev: rows.length + 1, bytes: body.slice(4 + length) })
      session.acked = header.to
      return reply(200, { rev: rows.length, head: rows.length, acked: header.to })
    },
  })
  const compact = () => {
    checkpoint.bytes = Y.mergeUpdates(rows.map((row) => row.bytes))
    checkpoint.base = rows.length
  }
  return { rows, sessions, endpoints, access, calls, pulls, finals, schemas, compact }
}

const rooms: CollabRoom[] = []
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => room.close()))
  vi.useRealTimers()
  signedIn = 'a@x.com'
})

let signedIn = 'a@x.com'

async function join(endpoints: CollabEndpoints, extra: Partial<OpenOptions> = {}) {
  const opened = await openCollabRoom({
    endpoints,
    principal: 'a@x.com',
    schema: 1,
    signedIn: () => signedIn,
    pollMs: 60_000,
    sendDelayMs: 0,
    ...extra,
  })
  if (opened.state !== 'live') throw new Error(opened.state)
  rooms.push(opened.room)
  return opened.room
}

const text = (room: CollabRoom) => room.doc.getText('t').toString()

const stores: DeviceStore[] = []
afterEach(() => stores.splice(0).forEach((store) => store.close()))
let devices = 0
async function device() {
  const store = (await openDeviceStore(`room-test-${devices++}`))!
  stores.push(store)
  return { store, doc: 'D' }
}

describe('collab room', () => {
  it('stamps every push with the schema of the editor that wrote it', async () => {
    const server = fakeServer()
    const a = await join(server.endpoints(), { schema: 3 })
    a.doc.getText('t').insert(0, 'one')
    await a.flush()
    a.doc.getText('t').insert(3, ' two')
    await a.flush()

    expect(server.schemas).toEqual([3, 3])
  })

  it('marks only the push of a closing tab as final', async () => {
    const server = fakeServer()
    const a = await join(server.endpoints())
    a.doc.getText('t').insert(0, 'kept ')
    await a.flush()
    a.doc.getText('t').insert(5, 'on close')

    await a.close()

    expect(server.finals).toEqual([false, true])
    expect(server.rows).toHaveLength(2)
  })

  it('keeps a checkpoint it opened from on the device, so the document reopens offline', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'one ')
    await writer.flush()
    server.compact()
    writer.doc.getText('t').insert(4, 'two')
    await writer.flush()
    const kept = await device()
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false

    const offline = await join(server.endpoints(), { device: kept })

    expect(text(offline)).toBe('one two')
  })

  it('opens from the checkpoint plus the rows after it, and pulls on from there', async () => {
    const server = fakeServer()
    const a = await join(server.endpoints())
    a.doc.getText('t').insert(0, 'one ')
    await a.flush()
    server.compact()
    a.doc.getText('t').insert(4, 'two ')
    await a.flush()

    const b = await join(server.endpoints())
    expect(text(b)).toBe('one two ')

    a.doc.getText('t').insert(8, 'three')
    await a.flush()
    server.pulls.length = 0
    await b.pull()
    expect(server.pulls).toEqual([2])
    expect(text(b)).toBe('one two three')
  })

  it('a quarantined rev holds its place in the order and applies nothing', async () => {
    const server = fakeServer()
    const a = await join(server.endpoints())
    a.doc.getText('t').insert(0, 'one ')
    await a.flush()
    const behind = await join(server.endpoints())
    a.doc.getText('t').insert(4, 'two ')
    await a.flush()
    // The server keeps the rev and drops its payload
    server.rows[1].bytes = new Uint8Array()

    const opened = await join(server.endpoints())
    expect([text(opened), opened.appliedThrough]).toEqual(['one ', 2])
    opened.doc.getText('t').insert(0, 'zero ')
    await opened.flush()

    await behind.pull()
    expect([text(behind), behind.appliedThrough]).toEqual(['zero one ', 3])
  })

  it('two writers converge on the server order after a poll', async () => {
    const server = fakeServer()
    const [a, b] = [await join(server.endpoints()), await join(server.endpoints())]

    a.doc.getText('t').insert(0, 'alpha ')
    b.doc.getText('t').insert(0, 'beta ')
    await Promise.all([a.flush(), b.flush()])
    await Promise.all([a.pull(), b.pull()])

    expect(text(a)).toBe(text(b))
    expect(text(a)).toContain('alpha ')
    expect(text(a)).toContain('beta ')
    expect(server.rows.map((row) => row.rev)).toEqual([1, 2])
    expect([a.saveState, b.saveState, a.appliedThrough]).toEqual(['clean', 'clean', 2])
  })

  it('a tab opened later sees everything typed before', async () => {
    const server = fakeServer()
    const a = await join(server.endpoints())
    a.doc.getText('t').insert(0, 'kept')
    await a.flush()

    expect(text(await join(server.endpoints()))).toBe('kept')
  })

  it('a lost answer is sent again and committed once', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let drop = true
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      if (drop) {
        drop = false
        throw new TypeError('connection reset')
      }
      return answer
    }
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'once')
    await vi.advanceTimersByTimeAsync(31_000)

    expect(server.rows).toHaveLength(1)
    expect([room.saveState, room.unsent]).toEqual(['clean', 0])
  })

  it('a resend that differs from what the server committed stops saving instead of overwriting', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let drop = true
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      if (drop) {
        drop = false
        for (const session of server.sessions.values()) session.shas[1] = 'f'.repeat(64)
        throw new TypeError('connection reset')
      }
      return answer
    }
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'once')
    await vi.advanceTimersByTimeAsync(31_000)

    expect([server.rows.length, room.saveState, room.unsent]).toEqual([1, 'failed', 1])
  })

  it('the unsent count each listener sees follows typing and drops to zero once committed', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    const seen: number[] = []
    room.onChange(() => seen.push(room.unsent))

    room.doc.getText('t').insert(0, 'a')
    room.doc.getText('t').insert(1, 'b')
    room.doc.getText('t').insert(2, 'c')
    await room.flush()

    expect([seen.slice(0, 3), seen.at(-1)]).toEqual([[1, 2, 3], 0])
  })

  it('a long queue of typing behind a busy document is still saved', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let busy = 5
    endpoints.push = async (body, options) =>
      busy-- > 0 ? reply(423, { collab: 'busy', retry_ms: 1000 }) : push(body, options)
    const room = await join(endpoints)

    for (let at = 0; at < 130; at++) room.doc.getText('t').insert(at, 'x')
    await vi.advanceTimersByTimeAsync(20_000)

    expect([room.saveState, room.unsent, text(await join(server.endpoints())).length]).toEqual([
      'clean',
      0,
      130,
    ])
  })

  it('a server that forgot what it acknowledged stops saving instead of resending in a loop', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let calls = 0
    endpoints.push = async (body, options) => {
      calls++
      for (const session of server.sessions.values()) session.acked = 0
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'one')
    await vi.advanceTimersByTimeAsync(0)
    for (const session of server.sessions.values()) session.acked = 1
    room.doc.getText('t').insert(3, 'two')
    await vi.advanceTimersByTimeAsync(1000)

    expect([room.saveState, calls < 5]).toEqual(['failed', true])
  })

  it('work committed after access was lost is not reported as unsaved', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      await held
      return answer
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'kept')
    const flushed = room.flush()
    await Promise.resolve()
    server.access.refuse = reply(403, { collab: 'forbidden' })
    await room.pull()
    release()
    await flushed

    expect([room.blocked, room.unsent, room.saveState]).toEqual(['lost_read', 0, 'clean'])
  })

  it('a pause ends when the server answers with anything else', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const answers = [
      reply(423, { collab: 'busy', retry_ms: 1000 }),
      reply(401, { collab: 'signed_out' }),
    ]
    endpoints.push = async () => answers.shift() ?? reply(401, { collab: 'signed_out' })
    const room = await join(endpoints)
    signedIn = 'Guest'

    room.doc.getText('t').insert(0, 'x')
    await vi.advanceTimersByTimeAsync(1500)

    expect([room.blocked, room.paused]).toEqual(['signed_out', null])
  })

  it('a busy document is pushed to again only after the delay it asks for', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let busy = 2
    let calls = 0
    endpoints.push = async (body, options) => {
      calls++
      if (busy-- > 0) return reply(423, { collab: 'busy', retry_ms: 1000 })
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'later')

    const flushed = room.flush()
    await vi.advanceTimersByTimeAsync(500)
    expect([calls, room.paused]).toEqual([1, 'busy'])
    await vi.advanceTimersByTimeAsync(2000)
    await flushed

    expect([calls, server.rows.length, room.saveState, room.paused]).toEqual([3, 1, 'clean', null])
  })

  it('typing after a lost answer is sent from where the server stopped', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let drop = true
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      if (drop) {
        drop = false
        throw new TypeError('connection reset')
      }
      return answer
    }
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'one ')
    await vi.advanceTimersByTimeAsync(0)
    room.doc.getText('t').insert(4, 'two')
    await vi.advanceTimersByTimeAsync(31_000)

    expect([server.rows.length, room.saveState, room.unsent]).toEqual([2, 'clean', 0])
    expect(text(await join(server.endpoints()))).toBe('one two')
  })

  it('closing while a push is in flight still sends what was typed meanwhile', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let first = true
    endpoints.push = async (body, options) => {
      if (first) {
        first = false
        await held
      }
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'first ')
    const sending = room.flush()
    room.doc.getText('t').insert(6, 'second')

    const closing = room.close()
    release()
    await Promise.all([sending, closing])

    expect(text(await join(server.endpoints()))).toBe('first second')
  })

  it('hiding the tab sends what was typed at once, and showing it sends nothing', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return push(body, options)
    }
    const room = await join(endpoints, { sendDelayMs: 60_000, sendMaxDelayMs: 60_000 })
    room.doc.getText('t').insert(0, 'typed before hiding')

    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toEqual([])

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => expect(room.unsent).toBe(0))
    } finally {
      delete (document as { visibilityState?: string }).visibilityState
    }

    expect(sent).toEqual([true])
    expect(text(await join(server.endpoints()))).toBe('typed before hiding')
  })

  it('leaving the page sends what was typed at once', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return push(body, options)
    }
    const room = await join(endpoints, { sendDelayMs: 60_000, sendMaxDelayMs: 60_000 })
    room.doc.getText('t').insert(0, 'typed before leaving')

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(room.unsent).toBe(0))

    expect(sent).toEqual([true])
    expect(text(await join(server.endpoints()))).toBe('typed before leaving')
  })

  it('leaving the page while a failed save waits to retry still sends what was typed', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return sent.length === 1 ? Promise.resolve(reply(500, {})) : push(body, options)
    }
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'typed before a failed save')
    await vi.waitFor(() => expect(sent).toEqual([undefined]))

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(sent).toEqual([undefined, true]))
    vi.restoreAllMocks()

    expect(text(await join(server.endpoints()))).toBe('typed before a failed save')
  })

  it('leaving the page while a save is still on its way sends it again', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    let lose = () => {}
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      if (sent.length > 1) return push(body, options)
      return new Promise((_, reject) => (lose = () => reject(new TypeError('Failed to fetch'))))
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'typed during a slow save')
    await vi.waitFor(() => expect(sent).toEqual([undefined]))

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(sent).toEqual([undefined, true]))
    lose()

    expect(text(await join(server.endpoints()))).toBe('typed during a slow save')
  })

  it('a viewer follows the document but nothing they do is sent', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    server.access.canWrite = false
    const viewer = await join(server.endpoints())

    writer.doc.getText('t').insert(0, 'news')
    await writer.flush()
    await viewer.pull()
    viewer.doc.getText('t').insert(0, 'mine ')

    expect([viewer.canWrite, viewer.unsent, text(viewer)]).toEqual([false, 0, 'mine news'])
    expect(server.rows).toHaveLength(1)
  })

  it('a signed-out tab keeps its typing and sends it once the same person signs back in', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(401, { collab: 'signed_out' })
    signedIn = 'Guest'

    room.doc.getText('t').insert(0, 'kept')
    await vi.advanceTimersByTimeAsync(0)
    expect([room.blocked, room.canWrite, room.unsent, server.rows.length]).toEqual([
      'signed_out',
      true,
      1,
      0,
    ])

    server.access.refuse = null
    signedIn = 'a@x.com'
    await room.pull()
    await vi.advanceTimersByTimeAsync(0)

    expect([room.blocked, room.saveState, server.rows.length]).toEqual([null, 'clean', 1])
  })

  it('a tab whose browser signed in as someone else stops and says so', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(409, { collab: 'principal_changed' })
    signedIn = 'b@x.com'

    room.doc.getText('t').insert(0, 'unsent')
    await room.flush()
    room.doc.getText('t').insert(0, 'more ')

    expect([room.blocked, room.canWrite, room.saveState, room.unsent]).toEqual([
      'other_user',
      false,
      'failed',
      1,
    ])
  })

  it('a writer whose edit access is taken away is told so on the next push', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(403, { collab: 'forbidden' })

    room.doc.getText('t').insert(0, 'late')
    await room.flush()

    expect([room.blocked, room.canWrite, room.saveState]).toEqual(['lost_edit', false, 'failed'])
  })

  it('a change the server refuses for good says why saving stopped', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    expect(room.stopped).toBe(null)
    server.access.refuse = reply(409, { collab: 'poison' })

    room.doc.getText('t').insert(0, 'bad')
    await room.flush()

    expect([room.stopped, room.saveState, room.blocked]).toEqual(['poison', 'failed', null])
  })

  it('a refusal that turns out to be a sign-out is not taken as lost access', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(404, { collab: 'not_found' })
    signedIn = 'Guest'

    await room.pull()

    expect([room.blocked, room.canWrite]).toEqual(['signed_out', true])
  })

  it('a document locked again keeps its typing and is not taken for a sign-out', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(401, { collab: 'locked' })

    room.doc.getText('t').insert(0, 'kept')
    await vi.advanceTimersByTimeAsync(0)
    expect([room.blocked, room.canWrite, room.unsent]).toEqual(['locked', true, 1])

    server.access.refuse = null
    await room.pull()
    await vi.advanceTimersByTimeAsync(0)

    expect([room.blocked, room.saveState, server.rows.length]).toEqual([null, 'clean', 1])
  })

  it('a tab whose sign-in went stale stops and asks for a reload', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    endpoints.push = async () => reply(400, { exc_type: 'CSRFTokenError' })
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'unsent')
    await room.flush()
    await room.pull()

    expect([room.blocked, room.canWrite, room.saveState, room.unsent]).toEqual([
      'stale_session',
      false,
      'failed',
      1,
    ])
  })

  it('opening with a stale sign-in asks for a reload', async () => {
    const endpoints = fakeServer().endpoints()
    endpoints.session = async () => reply(400, { exc_type: 'CSRFTokenError' })

    const opened = openCollabRoom({
      endpoints,
      principal: 'a@x.com',
      schema: 1,
      signedIn: () => 'a@x.com',
    })

    await expect(opened).rejects.toEqual(new CollabOpenError(400, 'stale_session'))
  })

  it('a writer who loses edit and then read access is told the larger loss', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(403, { collab: 'forbidden' })

    room.doc.getText('t').insert(0, 'late')
    await room.flush()
    await room.pull()

    expect(room.blocked).toBe('lost_read')
  })

  it('opens nothing while collaboration is off or the document is not collaborative', async () => {
    for (const state of ['disabled', 'unconverted']) {
      const opened = openCollabRoom({
        endpoints: fakeServer(state).endpoints(),
        principal: 'a@x.com',
        schema: 1,
        signedIn: () => 'a@x.com',
      })
      await expect(opened).resolves.toEqual({
        state,
      })
    }
  })
})

// IndexedDB answers through setImmediate, which must keep running
const fakeTime = () =>
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
declare const setImmediate: (callback: () => void) => void
const idle = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise<void>((resolve) => setImmediate(resolve))
}

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
      const pass = slow.push
      slow.push = async (body, request) => {
        await held
        return pass(body, request)
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
    const full = Object.create(kept.store)
    full.saveSession = () => Promise.reject(new DOMException('full', 'QuotaExceededError'))

    await expect(join(server.endpoints(), { device: { store: full, doc: 'D' } })).rejects.toThrow(
      'Failed to fetch',
    )
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

  it('work left from before the document was replaced is kept as a recovery copy, not applied', async () => {
    const server = fakeServer()
    const kept = await device()
    const stale = new Y.Doc()
    let bytes: Uint8Array = new Uint8Array()
    stale.on('update', (update: Uint8Array) => (bytes = update))
    stale.getText('t').insert(0, 'old')
    const old = { doc: 'D', sid: 'old', lineage: 'GONE', cid: 99, bound: true }
    await kept.store.capture(old, [{ doc: 'D', sid: 'old', seq: 1, bytes, sha: 'x' }])

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
})
