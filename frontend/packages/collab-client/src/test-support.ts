import { digest } from 'lib0/hash/sha256'
import { afterEach, vi } from 'vitest'
import * as yjs from 'yjs'

import { hex } from './bytes'
import { openRoom } from './open'
import { REMOTE } from './origins'
import type { Room } from './room'
import { openDeviceStore, type DeviceStore } from './store'
import type { Answer, CollabEndpoints, CollabRoom, OpenOptions } from './types'

export function reply(status: number, body: unknown): Answer {
  return {
    status,
    bytes: new TextEncoder().encode(JSON.stringify(body)),
  }
}

export function frame(
  header: object,
  rows: { rev: number; bytes: Uint8Array }[] = [],
  checkpoint: Uint8Array = new Uint8Array(),
): Answer {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const size =
    4 +
    json.length +
    8 +
    checkpoint.length +
    rows.reduce((sum, row) => sum + 12 + row.bytes.length, 0)
  const frameBytes = new Uint8Array(size)
  const view = new DataView(frameBytes.buffer)
  let at = 0
  view.setUint32(at, json.length)
  frameBytes.set(json, (at += 4))
  at += json.length
  view.setUint32(at, checkpoint.length)
  frameBytes.set(checkpoint, (at += 4))
  at += checkpoint.length
  view.setUint32(at, rows.length)
  at += 4
  for (const row of rows) {
    view.setBigUint64(at, BigInt(row.rev))
    view.setUint32((at += 8), row.bytes.length)
    frameBytes.set(row.bytes, (at += 4))
    at += row.bytes.length
  }

  return { status: 200, bytes: frameBytes }
}

interface FakeSession {
  cid: number
  acked: number
  shas: string[]
}

interface SeqRange {
  from: number
  to: number
  shas: string[]
}

function hasShaConflict(session: FakeSession, range: SeqRange) {
  for (let seq = range.from; seq <= Math.min(range.to, session.acked); seq++) {
    if (session.shas[seq] !== range.shas[seq - range.from]) {
      return true
    }
  }

  return false
}

// The server's rules: one gap-free order, a seq range must continue the session's ack
// `refuse` answers every request the way the server would for a tab it no longer hears
export function fakeServer(state = 'live', lineage = 'L') {
  const rows: { rev: number; bytes: Uint8Array }[] = []
  const sessions = new Map<string, FakeSession>()
  const access = { refuse: null as Answer | null, canWrite: true, online: true }
  // The gap the server asks for between pushes, on open and in each push reply
  const pace = { ms: undefined as number | undefined }
  const calls: string[] = []
  const pulls: number[] = []
  const finals: boolean[] = []
  const schemas: number[] = []
  // Rises with every quarantine; a pull from a tab that heard an older one answers `rebuild`
  const epoch = { now: 0, sent: [] as (number | undefined)[] }
  // The highest editor schema any stored row was written with
  const schema = { now: 1 }
  // Rows through `base` folded into one state, as a compaction leaves them
  const checkpoint: { base: number; bytes: Uint8Array } = { base: 0, bytes: new Uint8Array() }
  // The judge's count and last verdict; `answer` is what a report of a rev gets back
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
  // Whether push answers ask for a render, and the renders submitted, as the server would check them
  const copy = {
    wanted: false,
    renders: [] as { rev: number; q_epoch: number; sid: string; lineage: string; html: string }[],
  }
  const renderHeaders = new Map<
    string,
    { rev: number; q_epoch: number; sid: string; lineage: string }
  >()
  let nextClient = 1
  // A compacted state counted this big instead of the checkpoint's own size
  const counted = { state: null as number | null }
  // What the server publishes about sizes: the caps, and how full the document is now
  function limits() {
    return {
      fragment: 256 * 1024,
      edit_max: 4 * 2 ** 20,
      state_max: 4 * 2 ** 20,
      state_bytes: counted.state ?? checkpoint.bytes.byteLength,
      tail_bound: rows
        .filter((row) => row.rev > checkpoint.base)
        .reduce((sum, row) => sum + row.bytes.byteLength, 0),
    }
  }

  function splitPush(body: Uint8Array) {
    const length = new DataView(body.buffer, body.byteOffset).getUint32(0)
    const header = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + length)))
    return { length, header, bytes: body.slice(4 + length) }
  }

  // The realtime service: whether it answers a room set and carries rows, and the tabs' sockets
  const realtime = { answers: true, publishing: true, sockets: [] as FakeSocket[] }
  function roomKeys() {
    const now = Date.now() / 1000
    const at = Math.floor(now / 150)
    const nextAt = at + 1
    const keys = [`sc:${lineage}:${at}`, `sc:${lineage}:${nextAt}`]
    return { epoch: at, keys, epoch_seconds: 150, server_time: now }
  }

  function publish(event: string, message: object) {
    if (!realtime.publishing) return

    const room = roomKeys().keys[0]
    for (const listener of realtime.sockets) {
      if (listener.connected && listener.joined.has(room)) {
        listener.hear(event, { lineage, ...message })
      }
    }
  }

  function socket() {
    const created = fakeSocket(realtime)
    realtime.sockets.push(created)
    return created
  }

  function recordCall(call: string) {
    if (!access.online) {
      throw new TypeError('Failed to fetch')
    }

    calls.push(call)
  }

  function endpoints(): CollabEndpoints {
    return {
      async open() {
        recordCall('open')
        let tail: { rev: number; bytes: Uint8Array }[] = []
        if (state === 'live') {
          tail = rows.filter((row) => row.rev > checkpoint.base)
        }

        const header = {
          state,
          proto: 1,
          lineage,
          can_write: access.canWrite,
          pace_ms: pace.ms,
          base: checkpoint.base,
          q_epoch: epoch.now,
          schema: schema.now,
          limits: limits(),
          rooms: roomKeys(),
          restoring_ms: restoringMs(),
          restore_rev: restore.rev,
        }
        return frame(header, tail, checkpoint.bytes)
      },
      async pull(since, seen) {
        recordCall('pull')
        pulls.push(since)
        epoch.sent.push(seen)
        if (access.refuse) {
          return access.refuse
        }

        if (seen !== undefined && seen < epoch.now) {
          return frame({ state: 'rebuild', proto: 1, q_epoch: epoch.now })
        }

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
            restoring_ms: restoringMs(),
            restore_rev: restore.rev,
          },
          rows.filter((row) => row.rev > since),
        )
      },
      async session(sid, claim) {
        recordCall(claim ? 'claim' : 'session')
        if (!access.canWrite) {
          return reply(403, { collab: 'forbidden' })
        }

        if (claim) {
          if (claim.lineage !== lineage) {
            return reply(200, { claim: 'lineage' })
          }

          const taken = [...sessions.entries()].some(
            ([other, session]) => other !== sid && session.cid === claim.cid,
          )
          if (taken || (sessions.has(sid) && sessions.get(sid)!.cid !== claim.cid)) {
            return reply(200, { claim: 'clash' })
          }

          if (!sessions.has(sid)) {
            sessions.set(sid, { cid: claim.cid, acked: 0, shas: [] })
          }

          return reply(200, { claim: 'ok' })
        }

        if (!sessions.has(sid)) {
          sessions.set(sid, { cid: nextClient++, acked: 0, shas: [] })
        }

        return reply(200, { client_id: sessions.get(sid)!.cid })
      },
      async suspect(rev) {
        recordCall('suspect')
        judge.reports.push(rev)
        return judge.answer()
      },
      async stage(stage, idx, body) {
        recordCall('stage')
        if (access.refuse) {
          return access.refuse
        }

        const { header, bytes } = splitPush(body)
        pieces.push({ stage, idx })
        if ((sessions.get(header.sid)?.acked ?? 0) >= header.to) {
          return reply(200, { dup: true })
        }

        if (header.purpose === 'render') {
          const { rev, q_epoch, sid } = header
          renderHeaders.set(stage, { rev, q_epoch, sid, lineage: header.lineage })
        }

        if (!stages.has(stage)) {
          stages.set(stage, new Map())
        }

        shas.set(stage, header.sha_total)
        stages.get(stage)!.set(idx, bytes)
        return reply(200, { staged: idx })
      },
      async push(body) {
        recordCall('push')
        if (access.refuse) {
          return access.refuse
        }

        if (judge.held) {
          return reply(423, { collab: 'paused', reason: 'suspect', retry_ms: 300_000 })
        }

        const { length, header, bytes: inline } = splitPush(body)
        finals.push(header.final)
        schemas.push(header.schema)
        const session = sessions.get(header.sid)
        if (length > 4096 || header.shas?.length !== header.to - header.from + 1) {
          return reply(400, { collab: 'malformed' })
        }

        if (!session || session.cid !== header.cid) {
          return reply(409, { collab: 'client_conflict' })
        }

        if (header.from <= session.acked) {
          if (hasShaConflict(session, header)) {
            return reply(409, { collab: 'seq_conflict' })
          }

          if (header.to <= session.acked) {
            return reply(200, {
              dup: true,
              acked: session.acked,
              head: rows.length,
              copy: copy.wanted,
            })
          }
        }

        const isRestore = header.restore !== undefined
        const sameFence = header.restore === restore.token && !!restoringMs()
        if (isRestore && (!sameFence || header.seen_rev !== rows.length)) {
          return reply(409, { collab: 'restore_lost' })
        }

        if (!isRestore && restoringMs()) {
          return reply(423, RESTORING)
        }

        if (header.seen_rev < restore.rev) {
          return reply(409, { collab: 'restored', restore_rev: restore.rev })
        }

        if (header.from > session.acked + 1) {
          return reply(409, { collab: 'seq', acked: session.acked })
        }

        let bytes: Uint8Array = inline
        if (header.stage_id) {
          const staged = assemble(header.stage_id)
          if (!staged) {
            return reply(409, { collab: 'stage_incomplete' })
          }

          bytes = staged
        }

        // Only what follows the committed seqs is stored
        if (header.from <= session.acked) {
          bytes = yjs.diffUpdate(
            bytes,
            yjs.encodeStateVectorFromUpdate(yjs.mergeUpdates(rows.map((row) => row.bytes))),
          )
        }

        for (const [index, sha] of header.shas.entries()) {
          session.shas[header.from + index] = sha
        }

        rows.push({ rev: rows.length + 1, bytes })
        session.acked = header.to
        let encodedRow: string | null = null
        if (bytes.byteLength <= 32 * 1024) {
          encodedRow = base64(bytes)
        }

        const row: Record<string, unknown> = {
          rev: rows.length,
          schema: header.schema,
          u: encodedRow,
        }
        if (isRestore) {
          restore.rev = rows.length
          restore.until = 0
          restore.token = ''
          row.restore = true
        }

        publish('suite_collab_row', row)
        if (isRestore) {
          publish('suite_collab_ctl', { kind: 'restored', restore_rev: restore.rev })
        }

        const answer = { rev: rows.length, head: rows.length, acked: header.to, pace_ms: pace.ms }
        return reply(200, { ...answer, copy: copy.wanted })
      },
      async render(stage) {
        recordCall('render')
        if (access.refuse) {
          return access.refuse
        }

        const placed = renderHeaders.get(stage)
        const bytes = assemble(stage)
        if (!placed || !bytes) {
          return reply(409, { collab: 'stage_incomplete' })
        }

        copy.renders.push({ ...placed, html: new TextDecoder().decode(bytes) })
        return reply(202, { render: 'queued' })
      },
      async beginRestore(seenRev, version) {
        recordCall(`beginRestore ${seenRev} ${version}`)
        if (restoringMs()) {
          return reply(409, { collab: 'restoring' })
        }

        if (seenRev !== rows.length) {
          return reply(409, { collab: 'behind', head: rows.length })
        }

        return reply(200, { token: fence(FENCE_MS), base_rev: rows.length, fence_ms: FENCE_MS })
      },
      async cancelRestore(token) {
        recordCall('cancelRestore')
        if (token === restore.token && restoringMs()) {
          fence(null)
        }

        return reply(200, { cancelled: 1 })
      },
    }
  }

  // The whole of a stage's pieces, or null when one is missing or the bytes don't match its sha
  function assemble(stage: string) {
    const staged = stages.get(stage) ?? new Map<number, Uint8Array>()
    const ordered = [...staged.keys()].sort((left, right) => left - right)
    if (!ordered.length || ordered.some((idx, at) => idx !== at)) {
      return null
    }

    const bytes = new Uint8Array(ordered.reduce((sum, idx) => sum + staged.get(idx)!.length, 0))
    let at = 0
    for (const idx of ordered) {
      bytes.set(staged.get(idx)!, at)
      at += staged.get(idx)!.length
    }

    stages.delete(stage)

    const isWhole = hex(digest(bytes)) === shas.get(stage)
    return isWhole ? bytes : null
  }

  function compact() {
    checkpoint.bytes = yjs.mergeUpdates(rows.map((row) => row.bytes))
    checkpoint.base = rows.length
  }

  function quarantine(rev: number) {
    rows[rev - 1].bytes = new Uint8Array()
    epoch.now++
    publish('suite_collab_ctl', { kind: 'quarantine', q_epoch: epoch.now })
  }

  // A restore under way holds the document until `until`; 0 when none is
  const restore = { until: 0, rev: 0, token: '' }
  function restoringMs() {
    return Math.max(0, restore.until - Date.now()) || undefined
  }

  // A restore begins for `ms` and answers its token, or ends as `kind`: `restored` when it lands,
  // `restore_ended` when called off
  function fence(ms: number | null, kind = 'restore_ended') {
    restore.until = Date.now() + (ms ?? 0)
    restore.token = ''
    if (ms) {
      restore.token = 'f'.repeat(32)
      publish('suite_collab_ctl', { kind: 'restoring', fence_ms: ms })
    } else {
      publish('suite_collab_ctl', { kind })
    }

    return restore.token
  }

  // Another tab's restore lands as the next row, `bytes` making the document the version;
  // `lost` drops the row's broadcast or the notice that follows it
  function landRestore(bytes: Uint8Array, lost?: 'row' | 'notice') {
    rows.push({ rev: rows.length + 1, bytes })
    restore.rev = rows.length
    restore.until = 0
    if (lost !== 'row') {
      publish('suite_collab_row', { rev: rows.length, schema: 0, u: base64(bytes), restore: true })
    }

    if (lost !== 'notice') {
      publish('suite_collab_ctl', { kind: 'restored', restore_rev: restore.rev })
    }
  }

  // Another tab wrote to the document's comment threads
  function threadsChanged() {
    publish('suite_collab_ctl', { kind: 'threads' })
  }

  // An admin holds the document or releases it
  function hold(why?: string) {
    judge.held = why
    publish('suite_collab_ctl', { kind: why ? 'held' : 'released' })
  }

  return {
    rows,
    sessions,
    stages,
    pieces,
    copy,
    endpoints,
    access,
    pace,
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
    hold,
    fence,
    landRestore,
    threadsChanged,
    realtime,
    socket,
    roomKeys,
  }
}

const RESTORING = { collab: 'paused', reason: 'restoring', retry_ms: 1000 }
const FENCE_MS = 120_000

export function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

export type FakeServer = ReturnType<typeof fakeServer>
export type FakeSocket = ReturnType<typeof fakeSocket>

// A tab's socket to the realtime service: it joins what the room set names and acks only if the service answers
export function fakeSocket(realtime: { answers: boolean }) {
  type Handler = (message: unknown) => void
  const handlers = new Map<string, Set<Handler>>()
  const socket = {
    connected: true,
    joined: new Set<string>(),
    connects: 0,
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) {
        handlers.set(event, new Set())
      }

      handlers.get(event)!.add(handler)
    },
    off(event: string, handler?: Handler) {
      if (handler) {
        handlers.get(event)?.delete(handler)
      }
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
      for (const handler of handlers.get(event) ?? []) {
        handler(message)
      }
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

export const browser = { signedIn: 'a@x.com' }

export const rooms: Room[] = []
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => room.close()))
  vi.useRealTimers()
  browser.signedIn = 'a@x.com'
})

// An app whose editor writes schema `schema`, draws a position as it came, and renders nothing
export function adapterAt(schema: number) {
  return {
    app: 'test',
    schemaVersion: schema,
    toPeerPosition: (raw: unknown) => raw as object,
    toHtml: () => '',
  }
}

export async function join(endpoints: CollabEndpoints, extra: Partial<OpenOptions> = {}) {
  const opened = await openRoom({
    endpoints,
    expectedUser: 'a@x.com',
    adapter: adapterAt(1),
    signedIn: () => browser.signedIn,
    pollMs: 60_000,
    ...extra,
  })
  if (opened.state !== 'live') {
    throw new Error(opened.state)
  }

  // The room itself, so tests can also reach what the package keeps internal
  const room = opened.room as Room
  rooms.push(room)
  return room
}

export function text(room: CollabRoom) {
  return room.doc.getText('t').toString()
}

// A room that has just pushed while the server asks for a minute between pushes, so new typing waits
export async function joinMidPace(server: FakeServer, endpoints: CollabEndpoints) {
  server.pace.ms = 60_000
  const room = await join(endpoints)
  room.doc.getMap('m').set('opened', true)
  await room.flush()
  return room
}

// Three pieces' worth of typing
export const BIG = 'x'.repeat(600_000)

// Stands in for an editor binding that throws on content this browser can't place
export function breaksOn(room: CollabRoom, word: string) {
  room.doc.getText('t').observe((_, transaction) => {
    if (transaction.origin === REMOTE && text(room).includes(word)) {
      throw new Error('cannot place')
    }
  })
}

// One row that throws here, reported and judged `verdict`
export async function judgedOnce(server: ReturnType<typeof fakeServer>, verdict: string) {
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

export const stores: DeviceStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
})
let devices = 0
export async function device() {
  const store = (await openDeviceStore(`room-test-${devices++}`))!
  stores.push(store)
  return { store, doc: 'D' }
}

// IndexedDB answers through setImmediate, which must keep running
export function fakeTime() {
  return vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
}

declare const setImmediate: (callback: () => void) => void
export async function idle() {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

// Web Locks for one browser: a lock stays taken until the tab holding it lets go
export function fakeLocks() {
  const held = new Set<string>()
  async function request(
    name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => unknown,
  ) {
    if (held.has(name)) {
      return callback(null)
    }

    held.add(name)
    try {
      return await callback({ name, mode: 'exclusive' })
    } finally {
      held.delete(name)
    }
  }

  vi.stubGlobal('navigator', { ...navigator, locks: { request } })
}

// Endpoints whose pushes wait until `release` is called
export function heldPushes(server: FakeServer) {
  const gate = Promise.withResolvers<void>()
  const endpoints = { ...server.endpoints() }
  const push = endpoints.push
  endpoints.push = async (body, request) => {
    await gate.promise
    return push(body, request)
  }

  return { endpoints, release: gate.resolve }
}

// Endpoints whose pushes fail as if offline
export function offlinePushes(server: FakeServer) {
  const endpoints = { ...server.endpoints() }
  endpoints.push = async () => {
    throw new TypeError('Failed to fetch')
  }

  return endpoints
}
