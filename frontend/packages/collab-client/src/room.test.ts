import { digest } from 'lib0/hash/sha256'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { CollabOpenError } from './answers'
import { openCollabRoom } from './open'
import { hex } from './outbox'
import { REMOTE } from './room'
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
function fakeServer(state = 'live', lineage = 'L') {
  const rows: { rev: number; bytes: Uint8Array }[] = []
  const sessions = new Map<string, { cid: number; acked: number; shas: string[] }>()
  const access = { refuse: null as Answer | null, canWrite: true, online: true }
  const calls: string[] = []
  const pulls: number[] = []
  const finals: boolean[] = []
  const schemas: number[] = []
  // Rises with every quarantine; a pull from a tab that heard an older one answers `rebuild`
  const epoch = { now: 0, sent: [] as (number | undefined)[] }
  // The highest editor schema any stored row was written with
  const schema = { now: 1 }
  // Rows through `base` folded into one state, as a compaction leaves them
  const checkpoint = { base: 0, bytes: new Uint8Array() }
  // The judge's count and last verdict; `answer` is what a report of a rev gets back.
  // `held`: the document waits for an admin, so pushes are refused for a while
  const judge = {
    judged: 0,
    verdict: undefined as string | undefined,
    held: undefined as string | undefined,
    reports: [] as number[],
    answer: (): Answer => reply(202, { collab: 'judging', judged: judge.judged }),
  }
  // Pieces of big changes by stage, as the server keeps them until a push names the stage
  const stages = new Map<string, Map<number, Uint8Array>>()
  const pieces: { stage: string; idx: number }[] = []
  const shas = new Map<string, string>()
  let nextClient = 1
  // A compacted state counted this big instead of the checkpoint's own size
  const counted = { state: null as number | null }
  // What the server publishes about sizes: the caps, and how full the document is now
  const limits = () => ({
    fragment: 256 * 1024,
    edit_max: 4 * 2 ** 20,
    state_max: 4 * 2 ** 20,
    state_bytes: counted.state ?? checkpoint.bytes.byteLength,
    tail_bound: rows
      .filter((row) => row.rev > checkpoint.base)
      .reduce((sum, row) => sum + row.bytes.byteLength, 0),
  })
  const split = (body: Uint8Array) => {
    const length = new DataView(body.buffer, body.byteOffset).getUint32(0)
    const header = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + length)))
    return { length, header, bytes: body.slice(4 + length) }
  }
  // The realtime service: whether it answers a room set and carries rows, and the tabs' sockets
  const realtime = { answers: true, publishing: true, sockets: [] as FakeSocket[] }
  const roomKeys = () => {
    const now = Date.now() / 1000
    const at = Math.floor(now / 150)
    const keys = [`sc:${lineage}:${at}`, `sc:${lineage}:${at + 1}`]
    return { epoch: at, keys, epoch_seconds: 150, server_time: now }
  }
  const publish = (event: string, message: object) => {
    if (!realtime.publishing) return
    const room = roomKeys().keys[0]
    for (const socket of realtime.sockets)
      if (socket.connected && socket.joined.has(room)) socket.hear(event, { lineage, ...message })
  }
  const socket = () => {
    const created = fakeSocket(realtime)
    realtime.sockets.push(created)
    return created
  }
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
        lineage,
        can_write: access.canWrite,
        base: checkpoint.base,
        q_epoch: epoch.now,
        schema: schema.now,
        limits: limits(),
        rooms: roomKeys(),
      }
      return frame(header, tail, checkpoint.bytes)
    },
    async pull(since, seen) {
      reach('pull')
      pulls.push(since)
      epoch.sent.push(seen)
      if (access.refuse) return access.refuse
      if (seen !== undefined && seen < epoch.now)
        return frame({ state: 'rebuild', proto: 1, q_epoch: epoch.now })
      return frame(
        {
          state,
          proto: 1,
          q_epoch: epoch.now,
          judged: judge.judged,
          verdict: judge.verdict,
          held: judge.held,
          schema: schema.now,
          limits: limits(),
          rooms: roomKeys(),
        },
        rows.filter((row) => row.rev > since),
      )
    },
    async session(sid, claim) {
      reach(claim ? 'claim' : 'session')
      if (!access.canWrite) return reply(403, { collab: 'forbidden' })
      if (claim) {
        if (claim.lineage !== lineage) return reply(200, { claim: 'lineage' })
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
    async suspect(rev) {
      reach('suspect')
      judge.reports.push(rev)
      return judge.answer()
    },
    async stage(stage, idx, body) {
      reach('stage')
      if (access.refuse) return access.refuse
      const { header, bytes } = split(body)
      pieces.push({ stage, idx })
      if ((sessions.get(header.sid)?.acked ?? 0) >= header.to) return reply(200, { dup: true })
      if (!stages.has(stage)) stages.set(stage, new Map())
      shas.set(stage, header.sha_total)
      stages.get(stage)!.set(idx, bytes)
      return reply(200, { staged: idx })
    },
    async push(body) {
      reach('push')
      if (access.refuse) return access.refuse
      if (judge.held) return reply(423, { collab: 'paused', reason: 'suspect', retry_ms: 300_000 })
      const { length, header, bytes: inline } = split(body)
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
      let bytes = inline
      if (header.stage_id) {
        const staged = stages.get(header.stage_id) ?? new Map<number, Uint8Array>()
        const ordered = [...staged.keys()].sort((a, b) => a - b)
        if (!ordered.length || ordered.some((idx, at) => idx !== at))
          return reply(409, { collab: 'stage_incomplete' })
        bytes = new Uint8Array(ordered.reduce((sum, idx) => sum + staged.get(idx)!.length, 0))
        let at = 0
        for (const idx of ordered) {
          bytes.set(staged.get(idx)!, at)
          at += staged.get(idx)!.length
        }
        const whole = hex(digest(bytes)) === shas.get(header.stage_id)
        stages.delete(header.stage_id)
        if (!whole) return reply(409, { collab: 'stage_incomplete' })
      }
      header.shas.forEach((sha: string, index: number) => (session.shas[header.from + index] = sha))
      rows.push({ rev: rows.length + 1, bytes })
      session.acked = header.to
      const u = bytes.byteLength <= 32 * 1024 ? base64(bytes) : null
      publish('suite_collab_row', { rev: rows.length, schema: header.schema, u })
      return reply(200, { rev: rows.length, head: rows.length, acked: header.to })
    },
  })
  const compact = () => {
    checkpoint.bytes = Y.mergeUpdates(rows.map((row) => row.bytes))
    checkpoint.base = rows.length
  }
  const quarantine = (rev: number) => {
    rows[rev - 1].bytes = new Uint8Array()
    epoch.now++
    publish('suite_collab_ctl', { kind: 'quarantine', q_epoch: epoch.now })
  }
  return {
    rows,
    sessions,
    stages,
    pieces,
    endpoints,
    access,
    calls,
    pulls,
    finals,
    schemas,
    epoch,
    schema,
    judge,
    counted,
    compact,
    quarantine,
    realtime,
    socket,
    roomKeys,
  }
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

type FakeSocket = ReturnType<typeof fakeSocket>

// A tab's socket to the realtime service: it joins what the room set names and acks only if the service answers
function fakeSocket(realtime: { answers: boolean }) {
  type Handler = (message: unknown) => void
  const handlers = new Map<string, Set<Handler>>()
  const socket = {
    connected: true,
    joined: new Set<string>(),
    connects: 0,
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off(event: string, handler?: Handler) {
      if (handler) handlers.get(event)?.delete(handler)
    },
    emit(event: string, payload: { rooms: string[] }, ack: (answer: object) => void) {
      if (event !== 'suite_collab_rooms' || !socket.connected || !realtime.answers) return
      socket.joined = new Set(payload.rooms)
      queueMicrotask(() =>
        ack({ rooms: payload.rooms, pid: 2 ** 31, roster: [], count: 0, carets: [] }),
      )
    },
    connect() {
      socket.connects++
    },
    hear(event: string, message?: object) {
      for (const handler of handlers.get(event) ?? []) handler(message)
    },
    drop() {
      socket.connected = false
      socket.joined.clear()
      socket.hear('disconnect')
    },
    back() {
      socket.connected = true
      socket.hear('connect')
    },
  }
  return socket
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
// Three pieces' worth of typing
const BIG = 'x'.repeat(600_000)

// Stands in for an editor binding that throws on content this browser can't place
function breaksOn(room: CollabRoom, word: string) {
  room.doc.getText('t').observe((_, transaction) => {
    if (transaction.origin === REMOTE && text(room).includes(word)) throw new Error('cannot place')
  })
}

// One row that throws here, reported and judged `verdict`
async function judgedOnce(server: ReturnType<typeof fakeServer>, verdict: string) {
  const room = await join(server.endpoints())
  breaksOn(room, 'boom')
  const writer = await join(server.endpoints())
  writer.doc.getText('t').insert(0, 'boom')
  await writer.flush()
  await room.pull()
  server.judge.judged++
  server.judge.verdict = verdict
  await room.pull()
  return room
}

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

  it('a tab that may hold a quarantined change stops following and asks to be rebuilt', async () => {
    const server = fakeServer()
    const a = await join(server.endpoints())
    const b = await join(server.endpoints())
    a.doc.getText('t').insert(0, 'bad')
    await a.flush()
    await b.pull()
    expect([text(b), b.needsRebuild]).toEqual(['bad', false])
    server.quarantine(1)
    const heard = vi.fn()
    b.onChange(heard)

    await b.pull()

    expect([b.needsRebuild, heard.mock.calls.length > 0, server.epoch.sent.at(-1)]).toEqual([
      true,
      true,
      0,
    ])
    server.calls.length = 0
    await b.pull()
    expect(server.calls).toEqual([])
    const rebuilt = await join(server.endpoints())
    const later = await join(server.endpoints())
    later.doc.getText('t').insert(0, 'ok ')
    await later.flush()
    await rebuilt.pull()
    expect([text(rebuilt), rebuilt.needsRebuild, server.epoch.sent.at(-1)]).toEqual([
      'ok ',
      false,
      1,
    ])
  })

  it('a row that fails to apply is reported, and the tab sends nothing until the verdict', async () => {
    const server = fakeServer('live', 'apply-1')
    const a = await join(server.endpoints())
    breaksOn(a, 'boom')
    const b = await join(server.endpoints())
    b.doc.getText('t').insert(0, 'boom')
    await b.flush()

    await a.pull()

    expect([server.judge.reports, a.canWrite, a.paused, a.appliedThrough]).toEqual([
      [1],
      false,
      'suspect',
      0,
    ])
    a.doc.getText('t').insert(0, 'mine ')
    server.calls.length = 0
    await a.flush()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await a.pull()
    expect([server.calls, a.unsent, a.needsRebuild]).toEqual([['pull'], 1, false])
    server.judge.judged++
    server.judge.verdict = 'clean'
    await a.pull()
    expect([a.needsRebuild, a.stopped]).toEqual([true, null])
    // Work held nowhere else goes out from this copy before it is rebuilt
    await vi.waitFor(() => expect([a.unsent, a.paused, server.rows.length]).toEqual([0, null, 2]))
  })

  it('a server failing to answer the report is asked again, and never counts against this browser', async () => {
    vi.useFakeTimers()
    const server = fakeServer('live', 'apply-20')
    const failing = () => ({
      status: 502,
      bytes: new TextEncoder().encode('<html>Bad Gateway</html>'),
    })
    server.judge.answer = () =>
      server.judge.reports.length <= 3 ? failing() : reply(202, { collab: 'judging', judged: 0 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await vi.advanceTimersByTimeAsync(3 * 31_000)
    const waiting = [server.judge.reports.length, room.needsRebuild, room.stopped, room.paused]
    server.judge.judged++
    server.judge.verdict = 'quarantined'
    await room.pull()

    expect([waiting, room.needsRebuild]).toEqual([[4, false, null, 'suspect'], true])
  })

  it('a report refused for a lapsed sign-in is made again once the person signs back in', async () => {
    vi.useFakeTimers()
    const server = fakeServer('live', 'apply-21')
    server.judge.answer = () =>
      signedIn === 'Guest'
        ? reply(401, { collab: 'signed_out' })
        : reply(202, { collab: 'judging', judged: 0 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    signedIn = 'Guest'

    await room.pull()
    const out = room.blocked
    signedIn = 'a@x.com'
    await vi.advanceTimersByTimeAsync(31_000)
    server.judge.judged++
    server.judge.verdict = 'quarantined'
    await room.pull()

    expect([out, server.judge.reports.length, room.needsRebuild]).toEqual(['signed_out', 2, true])
  })

  it('a verdict from before the report is not taken for this one', async () => {
    const server = fakeServer('live', 'apply-2')
    server.judge.judged = 4
    server.judge.verdict = 'clean'
    // Another tab reported a moment ago, so this report waits and learns no count
    server.judge.answer = () => reply(423, { collab: 'busy', retry_ms: 60_000 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await room.pull()

    expect([room.needsRebuild, room.canWrite]).toEqual([false, false])
  })

  it('a quarantined row rebuilds the tab', async () => {
    const server = fakeServer('live', 'apply-3')
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    await room.pull()
    server.quarantine(1)
    server.judge.judged++
    server.judge.verdict = 'quarantined'

    await room.pull()

    expect([room.needsRebuild, room.stopped]).toEqual([true, null])
  })

  it('a held verdict keeps the tab locked and waiting', async () => {
    const room = await judgedOnce(fakeServer('live', 'apply-4'), 'held')
    expect([room.needsRebuild, room.canWrite, room.stopped]).toEqual([false, false, null])
  })

  it('a row the server already compacted is clean at once', async () => {
    const server = fakeServer('live', 'apply-5')
    server.judge.answer = () => reply(200, { verdict: 'clean', judged: 0 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await vi.waitFor(() => expect(room.needsRebuild).toBe(true))
  })

  it('a report another tab made a moment ago is made again after the wait', async () => {
    const server = fakeServer('live', 'apply-6')
    server.judge.answer = () =>
      server.judge.reports.length < 2
        ? reply(423, { collab: 'busy', retry_ms: 5 })
        : reply(202, { collab: 'judging', judged: 0 })
    const room = await judgedOnce(server, 'clean')
    expect(server.judge.reports).toEqual([1])
    await vi.waitFor(() => expect(server.judge.reports).toEqual([1, 1]))
    server.judge.judged++
    await room.pull()
    expect(room.needsRebuild).toBe(true)
  })

  it('a third clean verdict in ten minutes stops editing in this browser', async () => {
    const server = fakeServer('live', 'apply-7')
    for (const _ of [1, 2]) expect((await judgedOnce(server, 'clean')).needsRebuild).toBe(true)
    const third = await judgedOnce(server, 'clean')
    await vi.waitFor(() => expect(third.stopped).toBe('browser'))
    expect([third.needsRebuild, third.canWrite]).toEqual([false, false])
  })

  it('a held document locks the tab, keeps its typing and sends it once released', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.judge.held = 'change'

    room.doc.getText('t').insert(0, 'kept')
    await vi.advanceTimersByTimeAsync(1500)
    expect([room.held, room.canWrite, room.unsent, server.rows.length]).toEqual([
      'change',
      false,
      1,
      0,
    ])

    server.judge.held = undefined
    await room.pull()
    await vi.advanceTimersByTimeAsync(0)

    expect([room.held, room.canWrite, room.saveState, server.rows.length]).toEqual([
      null,
      true,
      'clean',
      1,
    ])
  })

  it('a pull tells a tab with nothing to send that the document is held, and when it is not', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.judge.held = 'bad_checkpoint'

    await room.pull()
    expect([room.held, room.canWrite]).toEqual(['bad_checkpoint', false])
    server.judge.held = undefined
    await room.pull()

    expect([room.held, room.canWrite]).toEqual([null, true])
  })

  it('a refused push does not hide that the whole document is in question', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.judge.held = 'bad_checkpoint'
    await room.pull()

    room.doc.getText('t').insert(0, 'x')
    await vi.advanceTimersByTimeAsync(1500)

    expect([room.held, room.paused]).toEqual(['bad_checkpoint', 'suspect'])
  })

  it('a report answered with a hold locks the tab as held', async () => {
    const server = fakeServer('live', 'apply-11')
    server.judge.answer = () =>
      reply(423, { collab: 'paused', reason: 'suspect', retry_ms: 300_000 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await vi.waitFor(() => expect(room.held).toBe('change'))
  })

  it('a tab stops following a document a newer editor wrote to, and goes read-only', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'new')
    await writer.flush()
    server.schema.now = 2

    await room.pull()
    room.doc.getText('t').insert(0, 'mine')
    writer.doc.getText('t').insert(0, 'later')
    await writer.flush()
    await room.pull()

    expect([room.newerSchema, room.canWrite, text(room), room.unsent]).toEqual([
      true,
      false,
      'mine',
      0,
    ])
  })

  it('typing from before a newer editor wrote is still saved', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints(), { sendDelayMs: 1000 })
    room.doc.getText('t').insert(0, 'kept')
    server.schema.now = 2

    await room.pull()
    await vi.advanceTimersByTimeAsync(1500)

    expect([room.newerSchema, room.saveState, text(await join(server.endpoints()))]).toEqual([
      true,
      'clean',
      'kept',
    ])
  })

  it('a tab opened on a document a newer editor wrote to shows it and sends nothing', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'new')
    await writer.flush()
    server.schema.now = 2

    const room = await join(server.endpoints())
    room.doc.getText('t').insert(0, 'x')
    await room.flush()

    expect([room.newerSchema, room.canWrite, text(room), room.unsent, server.rows.length]).toEqual([
      true,
      false,
      'xnew',
      0,
      1,
    ])
  })

  it('a tab tells its listeners why it stopped when it stops', async () => {
    const server = fakeServer('live', 'apply-10')
    for (const _ of [1, 2]) await judgedOnce(server, 'clean')
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const seen: (string | null)[] = []
    room.onChange(() => room.saveState === 'failed' && seen.push(room.stopped))
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    await room.pull()
    server.judge.judged++
    server.judge.verdict = 'clean'

    await room.pull()

    expect(seen[0]).toBe('browser')
  })

  it('a quarantine is not counted against this browser', async () => {
    const server = fakeServer('live', 'apply-9')
    await judgedOnce(server, 'clean')
    await judgedOnce(server, 'clean')
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    await room.pull()
    server.judge.judged++
    server.judge.verdict = 'quarantined'

    await room.pull()

    expect([room.needsRebuild, room.stopped]).toEqual([true, null])
  })

  it('clean verdicts older than ten minutes are not counted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const server = fakeServer('live', 'apply-8')
    await judgedOnce(server, 'clean')
    await judgedOnce(server, 'clean')
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
    const third = await judgedOnce(server, 'clean')
    expect([third.needsRebuild, third.stopped]).toEqual([true, null])
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

  it('a tab learns how full the document is when it opens, and again on every pull', async () => {
    const server = fakeServer()
    const [a, b] = [await join(server.endpoints()), await join(server.endpoints())]
    a.doc.getText('t').insert(0, 'alpha ')
    await a.flush()
    const opened = (await join(server.endpoints())).limits

    await b.pull()

    const row = server.rows[0].bytes.byteLength
    expect([opened?.tail_bound, b.limits?.tail_bound, b.limits?.edit_max]).toEqual([
      row,
      row,
      4 * 2 ** 20,
    ])
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

  it('a change too big for one push is staged in pieces and committed once', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    room.doc.getText('t').insert(0, BIG)

    await room.flush()

    expect(server.pieces.map((piece) => piece.idx)).toEqual([0, 1, 2])
    expect([server.rows.length, server.stages.size, room.saveState, room.unsent]).toEqual([
      1,
      0,
      'clean',
      0,
    ])
    expect(text(await join(server.endpoints()))).toBe(BIG)
  })

  it('pieces the server lost are staged again into the same stage, and the change commits', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let lose = true
    endpoints.push = async (body, options) => {
      if (lose) server.stages.forEach((staged) => staged.delete(1))
      lose = false
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(31_000)

    expect(server.pieces).toHaveLength(6)
    expect(new Set(server.pieces.map((piece) => piece.stage)).size).toBe(1)
    expect([server.rows.length, room.saveState]).toEqual([1, 'clean'])
  })

  it('a stage the server refuses is replaced by a new one', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const stage = endpoints.stage
    const ids: string[] = []
    endpoints.stage = async (id, idx, body) => {
      ids.push(id)
      if (ids.length > 1) return stage(id, idx, body)
      return reply(409, { collab: 'stage_conflict' })
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(31_000)

    const [refused, ...rest] = ids
    expect([rest.length, rest.includes(refused), new Set(rest).size]).toEqual([3, false, 1])
    expect([server.rows.length, room.saveState]).toEqual([1, 'clean'])
  })

  it('a document with too many pieces staged is pushed to again after the wait it asks for', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const stage = endpoints.stage
    let full = true
    endpoints.stage = async (id, idx, body) => {
      if (!full) return stage(id, idx, body)
      full = false
      return reply(423, { collab: 'stage_full', retry_ms: 60_000 })
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(59_000)
    expect([room.paused, server.rows.length]).toEqual(['stage_full', 0])
    await vi.advanceTimersByTimeAsync(2_000)

    expect([room.paused, server.rows.length, room.saveState]).toEqual([null, 1, 'clean'])
  })

  it('a change the server finds too large stops saving and says why', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    endpoints.stage = async () => reply(413, { collab: 'too_large' })
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await room.flush()

    expect([room.stopped, room.saveState, server.rows.length]).toEqual(['too_large', 'failed', 0])
  })

  it('a change a proxy refuses for its size stays unsent and saves once uploads get through', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const stage = endpoints.stage
    let proxy = true
    endpoints.stage = async (id, idx, body) =>
      proxy
        ? {
            status: 413,
            bytes: new TextEncoder().encode('<html>413 Request Entity Too Large</html>'),
          }
        : stage(id, idx, body)
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(500)
    const refused = [room.paused, room.stopped, room.unsent, server.rows.length]
    proxy = false
    await vi.advanceTimersByTimeAsync(31_000)

    expect([refused, [room.paused, room.saveState, server.rows.length]]).toEqual([
      ['upload_refused', null, 1, 0],
      [null, 'clean', 1],
    ])
  })

  it('a staged change whose answer was lost is acknowledged without staging it again', async () => {
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
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(31_000)

    expect(server.pieces).toHaveLength(4)
    expect([server.rows.length, room.saveState, room.unsent]).toEqual([1, 'clean', 0])
  })

  it('leaving the page with a big change unsent stages it without keepalive', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return push(body, options)
    }
    const room = await join(endpoints, { sendDelayMs: 60_000, sendMaxDelayMs: 60_000 })
    room.doc.getText('t').insert(0, BIG)

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(room.unsent).toBe(0))

    expect([sent, server.pieces.length]).toEqual([[undefined], 3])
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
    let told = 0
    room.onChange(() => told++)

    server.counted.state = null
    await room.pull()

    expect([opened, room.atLimit, told > 0]).toEqual([true, false, true])
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
    const a = await join(server.endpoints())
    a.doc.getText('t').insert(0, 'one ')
    await a.flush()
    const b = await join(server.endpoints(), { device: kept })
    a.doc.getText('t').insert(4, 'bad')
    await a.flush()
    await b.pull()
    expect(text(b)).toBe('one bad')
    server.quarantine(2)
    await b.pull()
    await b.close()

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

describe('collab room live', () => {
  const type = (room: CollabRoom, word: string) => {
    const t = room.doc.getText('t')
    t.insert(t.length, word)
    return room.flush()
  }
  const row = (server: ReturnType<typeof fakeServer>, rev: number, extra: object = {}) => ({
    lineage: 'L',
    rev,
    schema: 1,
    u: base64(server.rows[rev - 1].bytes),
    ...extra,
  })

  it('two tabs see each other’s edits without waiting for a poll', async () => {
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await idle()
    const pulls = server.pulls.length

    await type(writer, 'hello')

    expect([reader.live, text(reader), reader.appliedThrough]).toEqual(['live', 'hello', 1])
    expect(server.pulls.length).toBe(pulls)
  })

  it('a realtime service that never answers the room set leaves the tab collaborating by polling', async () => {
    fakeTime()
    const server = fakeServer()
    server.realtime.answers = false
    const reader = await join(server.endpoints(), { socket: server.socket(), pollMs: 1000 })
    const writer = await join(server.endpoints(), { socket: server.socket(), pollMs: 1000 })
    const before = reader.live
    await vi.advanceTimersByTimeAsync(5000)

    await type(writer, 'polled')
    await vi.advanceTimersByTimeAsync(6000)

    expect([before, reader.live, text(reader)]).toEqual(['joining', 'polling', 'polled'])
  })

  it('a realtime restart drops tabs to polling and they catch up once it is back', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)

    server.realtime.sockets.forEach((socket) => socket.drop())
    await type(writer, 'missed')
    await vi.advanceTimersByTimeAsync(5000)
    const down = [reader.live, text(reader)]
    server.realtime.sockets.forEach((socket) => socket.back())
    await vi.advanceTimersByTimeAsync(100)

    expect(down).toEqual(['polling', ''])
    expect([reader.live, text(reader)]).toEqual(['live', 'missed'])
  })

  it('a writer whose own rows stop coming back three times falls back to polling until one does', async () => {
    fakeTime()
    const server = fakeServer()
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    server.realtime.publishing = false

    const states = []
    for (const word of ['a', 'b', 'c']) {
      await type(writer, word)
      await vi.advanceTimersByTimeAsync(2000)
      states.push(writer.live)
    }
    server.realtime.publishing = true
    await type(writer, 'd')

    expect(states).toEqual(['live', 'live', 'polling'])
    expect([writer.live, text(writer), writer.appliedThrough]).toEqual(['live', 'abcd', 4])
  })

  it('rows heard out of order wait for the missing one, and a hole that stays open is pulled', async () => {
    fakeTime()
    const server = fakeServer()
    const socket = server.socket()
    const reader = await join(server.endpoints(), { socket })
    const writer = await join(server.endpoints())
    await vi.advanceTimersByTimeAsync(0)
    server.realtime.publishing = false
    for (const word of ['a', 'b', 'c', 'd']) await type(writer, word)
    const pulls = server.pulls.length

    socket.hear('suite_collab_row', row(server, 2))
    const waiting = text(reader)
    socket.hear('suite_collab_row', row(server, 1))
    const ordered = text(reader)
    socket.hear('suite_collab_row', row(server, 4))
    await vi.advanceTimersByTimeAsync(900)
    const held = [text(reader), server.pulls.length - pulls]
    await vi.advanceTimersByTimeAsync(200)

    expect([waiting, ordered, held]).toEqual(['', 'ab', ['ab', 0]])
    expect([text(reader), server.pulls.length - pulls]).toEqual(['abcd', 1])
  })

  it('a row too big to carry inline is pulled', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)

    await type(writer, 'x'.repeat(40_000))
    await vi.advanceTimersByTimeAsync(100)

    expect(text(reader).length).toBe(40_000)
  })

  it('a row of another lineage of the document is ignored', async () => {
    const server = fakeServer()
    const socket = server.socket()
    const reader = await join(server.endpoints(), { socket })
    const writer = await join(server.endpoints())
    server.realtime.publishing = false
    await type(writer, 'old copy')

    socket.hear('suite_collab_row', row(server, 1, { lineage: 'other' }))

    expect([text(reader), reader.appliedThrough]).toEqual(['', 0])
  })

  it('a row written by a newer editor is not applied live and the tab follows as an older editor', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), { socket: server.socket(), schema: 2 })
    await vi.advanceTimersByTimeAsync(0)
    server.schema.now = 2

    await type(writer, 'newer')
    await vi.advanceTimersByTimeAsync(100)

    expect([text(reader), reader.newerSchema]).toEqual(['', true])
  })

  it('a quarantine heard live sends the tab to be opened again', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints())
    await type(writer, 'bad')
    await vi.advanceTimersByTimeAsync(0)

    server.quarantine(1)
    await vi.advanceTimersByTimeAsync(100)

    expect(reader.needsRebuild).toBe(true)
  })

  it('a socket that gave up reconnecting is asked again when the browser comes online', async () => {
    fakeTime()
    const server = fakeServer()
    const socket = server.socket()
    await join(server.endpoints(), { socket })
    socket.connected = false

    window.dispatchEvent(new Event('online'))

    expect(socket.connects).toBe(1)
  })

  it('a tab moves to the next epoch’s rooms early in it and leaves its rooms when closed', async () => {
    fakeTime()
    const server = fakeServer()
    const socket = server.socket()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const room = await join(server.endpoints(), { socket })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(300_000)
    const moved = [[...socket.joined], room.live]
    const now = server.roomKeys().keys
    vi.mocked(Math.random).mockRestore()
    await room.close()

    expect(moved).toEqual([now, 'live'])
    expect([...socket.joined]).toEqual([])
  })
})
