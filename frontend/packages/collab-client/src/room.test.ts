import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { openCollabRoom, type Answer, type CollabEndpoints, type CollabRoom } from './room'

const reply = (status: number, body: unknown): Answer => ({
  status,
  bytes: new TextEncoder().encode(JSON.stringify(body)),
})

function frame(header: object, rows: { rev: number; bytes: Uint8Array }[] = []): Answer {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const size = 4 + json.length + 8 + rows.reduce((sum, row) => sum + 12 + row.bytes.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let at = 0
  view.setUint32(at, json.length)
  out.set(json, (at += 4))
  at += json.length
  view.setUint32(at, 0)
  view.setUint32((at += 4), rows.length)
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
  const sessions = new Map<string, { cid: number; acked: number }>()
  const access = { refuse: null as Answer | null, canWrite: true }
  let nextClient = 1
  const endpoints = (): CollabEndpoints => ({
    async open() {
      return frame({ state, proto: 1, lineage: 'L', can_write: access.canWrite }, state === 'live' ? rows : [])
    },
    async pull(since) {
      if (access.refuse) return access.refuse
      return frame({ state, proto: 1 }, rows.filter((row) => row.rev > since))
    },
    async session(sid) {
      if (!sessions.has(sid)) sessions.set(sid, { cid: nextClient++, acked: 0 })
      return reply(200, { client_id: sessions.get(sid)!.cid })
    },
    async push(body) {
      if (access.refuse) return access.refuse
      const view = new DataView(body.buffer, body.byteOffset)
      const length = view.getUint32(0)
      const header = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + length)))
      const session = sessions.get(header.sid)!
      if (header.to <= session.acked) return reply(200, { dup: true, acked: session.acked, head: rows.length })
      if (header.from !== session.acked + 1) return reply(409, { collab: 'seq', acked: session.acked })
      rows.push({ rev: rows.length + 1, bytes: body.slice(4 + length) })
      session.acked = header.to
      return reply(200, { rev: rows.length, head: rows.length, acked: header.to })
    },
  })
  return { rows, endpoints, access }
}

const rooms: CollabRoom[] = []
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => room.close()))
  vi.useRealTimers()
  signedIn = 'a@x.com'
})

let signedIn = 'a@x.com'

async function join(endpoints: CollabEndpoints) {
  const opened = await openCollabRoom({
    endpoints,
    principal: 'a@x.com',
    signedIn: () => signedIn,
    pollMs: 60_000,
    sendDelayMs: 0,
  })
  if (opened.state !== 'live') throw new Error(opened.state)
  rooms.push(opened.room)
  return opened.room
}

const text = (room: CollabRoom) => room.doc.getText('t').toString()

describe('collab room', () => {
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
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    await flushed

    expect([calls, server.rows.length, room.saveState]).toEqual([3, 1, 'clean'])
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
    expect([room.blocked, room.canWrite, room.unsent, server.rows.length]).toEqual(['signed_out', true, 1, 0])

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

    expect([room.blocked, room.canWrite, room.saveState, room.unsent]).toEqual(['other_user', false, 'failed', 1])
  })

  it('a writer whose edit access is taken away is told so on the next push', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(403, { collab: 'forbidden' })

    room.doc.getText('t').insert(0, 'late')
    await room.flush()

    expect([room.blocked, room.canWrite, room.saveState]).toEqual(['lost_edit', false, 'failed'])
  })

  it('a refusal that turns out to be a sign-out is not taken as lost access', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(404, { collab: 'not_found' })
    signedIn = 'Guest'

    await room.pull()

    expect([room.blocked, room.canWrite]).toEqual(['signed_out', true])
  })

  it('opens nothing while collaboration is off or the document is not collaborative', async () => {
    for (const state of ['disabled', 'unconverted']) {
      const opened = openCollabRoom({ endpoints: fakeServer(state).endpoints(), principal: 'a@x.com', signedIn: () => 'a@x.com' })
      await expect(opened).resolves.toEqual({
        state,
      })
    }
  })
})
