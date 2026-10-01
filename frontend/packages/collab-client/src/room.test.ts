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

// The server's rules: one gap-free order, a seq range must continue the session's ack
function fakeServer(state = 'live') {
  const rows: { rev: number; bytes: Uint8Array }[] = []
  const sessions = new Map<string, { cid: number; acked: number }>()
  let nextClient = 1
  const endpoints = (): CollabEndpoints => ({
    async open() {
      return frame({ state, proto: 1, lineage: 'L', can_write: true }, state === 'live' ? rows : [])
    },
    async pull(since) {
      return frame({ state, proto: 1 }, rows.filter((row) => row.rev > since))
    },
    async session(sid) {
      if (!sessions.has(sid)) sessions.set(sid, { cid: nextClient++, acked: 0 })
      return reply(200, { client_id: sessions.get(sid)!.cid })
    },
    async push(body) {
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
  return { rows, endpoints }
}

const rooms: CollabRoom[] = []
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => room.close()))
  vi.useRealTimers()
})

async function join(endpoints: CollabEndpoints) {
  const opened = await openCollabRoom({ endpoints, principal: 'a@x.com', pollMs: 60_000, sendDelayMs: 0 })
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

  it('opens nothing while collaboration is off or the document is not collaborative', async () => {
    for (const state of ['disabled', 'unconverted']) {
      await expect(openCollabRoom({ endpoints: fakeServer(state).endpoints(), principal: 'a@x.com' })).resolves.toEqual({
        state,
      })
    }
  })
})
