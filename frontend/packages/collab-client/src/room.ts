import { digest } from 'lib0/hash/sha256'
import * as Y from 'yjs'
import { decodeFrame, encodePush, type FrameHeader, type OpenState, type Row } from './frames'
import type { DeviceCopy, DeviceStore, StoredEntry, StoredSession } from './store'

export interface Answer {
  status: number
  bytes: Uint8Array
}

// A clientID a tab chose itself offline, offered to the server before it is used anywhere
export interface Claim {
  cid: number
  lineage: string
}

// The product's routes for one document. Each answers every status as it came;
// a network failure throws
export interface CollabEndpoints {
  open(): Promise<Answer>
  pull(since: number): Promise<Answer>
  push(body: Uint8Array<ArrayBuffer>, options?: { keepalive?: boolean }): Promise<Answer>
  session(sid: string, claim?: Claim): Promise<Answer>
}

export interface OpenOptions {
  endpoints: CollabEndpoints
  principal: string
  // Who the browser is signed in as now, or 'Guest'
  signedIn: () => string
  // Where unsent work and the last committed copy survive the tab; without it they live only in memory
  device?: { store: DeviceStore; doc: string } | null
  pollMs?: number
  sendDelayMs?: number
  sendMaxDelayMs?: number
}

export type SaveState = 'clean' | 'saving' | 'unsaved' | 'failed'

// Why the server stopped hearing this tab. `offline` is only for a tab with no device store to keep work in.
// Only `signed_out`, `locked` and `offline` clear, once the server hears it again
export type Blocked = 'signed_out' | 'locked' | 'offline' | 'stale_session' | 'other_user' | 'lost_edit' | 'lost_read'

export const recoverable = (blocked: Blocked) => blocked === 'signed_out' || blocked === 'locked' || blocked === 'offline'

export interface CollabRoom {
  readonly doc: Y.Doc
  readonly canWrite: boolean
  readonly blocked: Blocked | null
  // Why the server asked this tab to wait before saving again, until a push is committed
  readonly paused: string | null
  readonly saveState: SaveState
  readonly unsent: number
  // Whether unsent work outlives this tab
  readonly onDevice: boolean
  readonly appliedThrough: number
  onChange(listener: () => void): () => void
  pull(): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

export type Opened = { state: 'live'; room: CollabRoom } | { state: Exclude<OpenState, 'live'> }

export class CollabOpenError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`Could not open the collaborative document (${reason ?? status})`)
    this.name = 'CollabOpenError'
  }
}

// Updates applied from the server; everything else in the doc is this tab's own work
export const REMOTE = Symbol('collab-remote')
// Another tab's unsent work, applied here so this tab shows and sends it
const ADOPT = Symbol('collab-adopt')

// Each sha adds 67 bytes to the push header, which the server caps at 4 KiB
const MAX_ENTRIES = 48
const MAX_PUSH_BYTES = 256 * 1024
// Browsers refuse keepalive bodies over 64 KiB
const MAX_KEEPALIVE_BYTES = 60 * 1024
// Server-issued clientIDs sit below this; a tab offline picks its own above it
const DEVICE_IDS = 2 ** 30
const PERSIST_AFTER_MS = 60_000

// `sha` lets the server tell a resent seq from a different one under the same number
type Entry = { seq: number; bytes: Uint8Array; sha: string }

// One session's unsent work: this tab's own, or one adopted from a tab that closed
type Outbox = { sid: string; cid: number; pending: Entry[]; nextSeq: number; acked: number; release: () => void }

export async function openCollabRoom(options: OpenOptions): Promise<Opened> {
  const { endpoints, device } = options
  let opened: Answer
  try {
    opened = await endpoints.open()
  } catch (error) {
    const copy = device ? await device.store.copy(device.doc).catch(() => null) : null
    if (!copy) throw error
    return { state: 'live', room: await openOffline(copy, options, error) }
  }
  if (opened.status !== 200) throw openError(opened, options)
  const { header, rows } = decodeFrame(opened.bytes)
  if (header.state !== 'live') return { state: header.state }

  const doc = new Y.Doc()
  let canWrite = !!header.can_write
  const sid = randomHex(16)
  if (canWrite) {
    const answer = await endpoints.session(sid)
    if (answer.status === 200) doc.clientID = json(answer).client_id
    else if (answer.status === 403 || answer.status === 404) canWrite = false
    else throw openError(answer, options)
  }
  const room = new Room(doc, header.lineage!, canWrite, sid, options, true)
  await room.start(rows)
  return { state: 'live', room }
}

// The device copy, with a clientID no session of this document has used, bound only once the server accepts the claim
async function openOffline(copy: DeviceCopy, options: OpenOptions, unreachable: unknown) {
  const { store, doc: key } = options.device!
  const doc = new Y.Doc()
  Y.applyUpdate(doc, copy.bytes, REMOTE)
  const sid = randomHex(16)
  // Another tab took the same clientID between reading the sessions and saving this one
  for (let attempt = 0; copy.canWrite; attempt++) {
    const used = new Set([...Y.decodeStateVector(Y.encodeStateVector(doc)).keys()])
    for (const session of await store.sessions(key)) used.add(session.cid)
    let cid = 0
    while (!cid || used.has(cid)) cid = DEVICE_IDS + Math.floor(Math.random() * DEVICE_IDS)
    const session: StoredSession = { doc: key, sid, lineage: copy.lineage, cid, bound: false }
    try {
      await store.saveSession(session)
      doc.clientID = cid
      break
    } catch (error) {
      if ((error as Error)?.name !== 'ConstraintError' || attempt === 2) throw unreachable
    }
  }
  // A viewer has nothing to claim
  const room = new Room(doc, copy.lineage, copy.canWrite, sid, options, !copy.canWrite)
  room.appliedThrough = copy.rev
  await room.start([])
  return room
}

class Room implements CollabRoom {
  saveState: SaveState = 'clean'
  blocked: Blocked | null = null
  paused: string | null = null
  appliedThrough = 0
  private own: Outbox
  private adopted: Outbox[] = []
  private inFlight: Promise<void> | null = null
  private pulling: Promise<void> | null = null
  private connecting: Promise<void> | null = null
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private firstUnsentAt = 0
  private unsentSince = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retrying: Promise<void> | null = null
  private endRetry: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<() => void>()
  private closed = false
  private dead: string | null = null
  private persisted = false
  private device: { store: DeviceStore; doc: string } | null

  constructor(
    readonly doc: Y.Doc,
    private readonly lineage: string,
    private writable: boolean,
    sid: string,
    private readonly options: OpenOptions,
    // False while a clientID chosen offline waits for the server to accept it
    private bound: boolean,
  ) {
    this.device = options.device ?? null
    this.own = { sid, cid: doc.clientID, pending: [], nextSeq: 1, acked: 0, release: () => {} }
  }

  async start(rows: Row[]) {
    this.doc.on('update', this.capture)
    if (this.device && this.writable && this.bound) {
      await this.device.store.saveSession(this.session()).catch(() => this.lostStore())
    }
    this.own.release = (await holdLock(this.lockName(this.own.sid))) ?? (() => {})
    this.apply(rows, true)
    if (this.writable) await this.adopt()
    this.pollTimer = setInterval(() => void this.tick(), this.options.pollMs ?? 2000)
  }

  get canWrite() {
    return this.writable
  }

  get onDevice() {
    return !!this.device
  }

  get unsent() {
    return this.outboxes().reduce((sum, box) => sum + box.pending.length, 0)
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  pull(): Promise<void> {
    if (this.closed || this.blocked === 'other_user' || this.blocked === 'lost_read') return Promise.resolve()
    if (!this.bound) return this.dead ? Promise.resolve() : this.connect()
    return this.connecting ?? this.fetch()
  }

  private fetch(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.pulling ??= this.options.endpoints
      .pull(this.appliedThrough)
      .then((answer) => {
        if (answer.status !== 200) {
          this.refused(answer, 'lost_read')
          return
        }
        this.apply(decodeFrame(answer.bytes).rows)
        this.heard()
      })
      .catch(() => this.unreachable())
      .finally(() => (this.pulling = null))
    return this.pulling
  }

  // Waits out each retry delay rather than pushing again at once
  async flush() {
    while (!this.closed && this.bound && (this.inFlight || this.unsent) && this.saveState !== 'failed') {
      await (this.inFlight ?? this.retrying ?? this.send())
    }
  }

  async close() {
    if (this.closed) return
    if (this.inFlight) await this.inFlight
    if (this.bound && this.unsent && this.saveState !== 'failed') {
      this.clearTimers()
      await this.send({ keepalive: true })
    }
    this.closed = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.clearTimers()
    this.doc.off('update', this.capture)
    this.listeners.clear()
    for (const box of this.outboxes()) box.release()
    if (this.device && !this.own.pending.length && !this.dead) {
      void this.device.store.forget(this.device.doc, this.own.sid).catch(() => {})
    }
  }

  private tick() {
    if (this.unsent && this.unsentSince && Date.now() - this.unsentSince > PERSIST_AFTER_MS) this.persist()
    void this.pull()
  }

  // Claim the clientID chosen offline, send what was typed, and only then take anyone else's rows
  private connect(): Promise<void> {
    this.connecting ??= this.claim(this.own)
      .then(async (answer) => {
        if (answer === null || this.closed) return
        if (answer !== 'ok') {
          // Other tabs' work never used this clientID, so a later tab can still send it
          for (const box of this.adopted) box.release()
          this.adopted = []
          await this.die(lost(answer))
          return
        }
        this.bound = true
        this.heard()
        await this.adopt()
        await this.flush()
        await this.fetch()
      })
      .finally(() => (this.connecting = null))
    return this.connecting
  }

  // `null` when the claim got no verdict this time; a refusal with a reason is final
  private async claim(box: Outbox): Promise<string | null> {
    let answer: Answer
    try {
      answer = await this.options.endpoints.session(box.sid, { cid: box.cid, lineage: this.lineage })
    } catch {
      this.unreachable()
      return null
    }
    const verdict = answer.status === 200 ? json(answer)?.claim : null
    if (typeof verdict === 'string') {
      if (verdict === 'ok' && this.device) {
        const session = { doc: this.device.doc, sid: box.sid, lineage: this.lineage, cid: box.cid, bound: true }
        await this.device.store.saveSession(session).catch(() => {})
      }
      return verdict
    }
    return this.refused(answer, 'lost_edit') ? null : reasonOf(answer)
  }

  // Unsent work other tabs of this document left on the device, once no live tab holds it
  private async adopt() {
    if (!this.device || this.dead) return
    const { store, doc: key } = this.device
    const sessions = await store.sessions(key).catch(() => [])
    for (const session of sessions) {
      if (session.sid === this.own.sid || this.adopted.some((box) => box.sid === session.sid)) continue
      if (!session.bound && !this.bound) continue
      const release = await holdLock(this.lockName(session.sid))
      if (!release) continue
      if (this.closed) return release()
      const entries = await store.entries(key, session.sid).catch(() => [] as StoredEntry[])
      if (!entries.length) {
        await store.forget(key, session.sid).catch(() => {})
        release()
        continue
      }
      const box: Outbox = {
        sid: session.sid,
        cid: session.cid,
        pending: entries.map(({ seq, bytes, sha }) => ({ seq, bytes, sha })),
        nextSeq: entries[entries.length - 1].seq + 1,
        acked: entries[0].seq - 1,
        release,
      }
      const verdict = session.lineage !== this.lineage ? 'lineage' : session.bound ? 'ok' : await this.claim(box)
      if (this.closed) return release()
      if (verdict !== 'ok') {
        if (verdict) await store.recover(key, session.sid, lost(verdict)).catch(() => {})
        release()
        continue
      }
      Y.applyUpdate(this.doc, Y.mergeUpdates(box.pending.map((entry) => entry.bytes)), ADOPT)
      this.adopted.push(box)
    }
    this.counted()
    if (this.unsent && this.bound) this.scheduleSend()
  }

  // Rows are applied strictly in rev order; a hole waits for the next pull
  private apply(rows: Row[], opening = false) {
    const next = rows.filter((row) => row.rev > this.appliedThrough).sort((a, b) => a.rev - b.rev)
    const run: Row[] = []
    for (const row of next) {
      if (row.rev !== this.appliedThrough + run.length + 1) break
      run.push(row)
    }
    if (!run.length && !opening) return
    const bytes = run.length ? Y.mergeUpdates(run.map((row) => row.bytes)) : null
    if (bytes) Y.applyUpdate(this.doc, bytes, REMOTE)
    if (run.length) this.appliedThrough = run[run.length - 1].rev
    if (this.device) {
      const copy = { lineage: this.lineage, rev: this.appliedThrough, canWrite: this.writable }
      void this.device.store.commit(this.device.doc, copy, bytes).catch(() => {})
    }
    if (run.length) this.changed()
  }

  private capture = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || origin === ADOPT || !this.writable || this.closed) return
    const entry = { seq: this.own.nextSeq++, bytes: update, sha: hex(digest(update)) }
    this.own.pending.push(entry)
    if (this.device) {
      const stored = { doc: this.device.doc, sid: this.own.sid, ...entry }
      const write = this.dead
        ? this.device.store.recover(this.device.doc, this.own.sid, this.dead, [stored])
        : this.device.store.capture(this.session(), [stored])
      void write.catch(() => this.lostStore())
    }
    if (this.saveState !== 'failed') this.saveState = this.inFlight ? 'saving' : 'unsaved'
    this.counted()
    if (this.bound) this.scheduleSend()
    else this.persist()
  }

  private scheduleSend() {
    const now = Date.now()
    if (!this.sendTimer) this.firstUnsentAt = now
    else clearTimeout(this.sendTimer)
    const delay = Math.min(this.options.sendDelayMs ?? 1000, this.firstUnsentAt + (this.options.sendMaxDelayMs ?? 3000) - now)
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null
      void this.send()
    }, Math.max(0, delay))
  }

  private send(request: { keepalive?: boolean } = {}): Promise<void> {
    const box = this.adopted.find((other) => other.pending.length) ?? this.own
    if (this.inFlight || this.retrying || !box.pending.length || this.closed || !this.bound || this.saveState === 'failed') {
      return this.inFlight ?? this.retrying ?? Promise.resolve()
    }
    const batch: Entry[] = []
    let size = 0
    const maxBytes = request.keepalive ? MAX_KEEPALIVE_BYTES : MAX_PUSH_BYTES
    for (const entry of box.pending) {
      if (batch.length && (batch.length >= MAX_ENTRIES || size + entry.bytes.byteLength > maxBytes)) break
      batch.push(entry)
      size += entry.bytes.byteLength
    }
    const header = {
      proto: 1,
      lineage: this.lineage,
      principal: this.options.principal,
      sid: box.sid,
      from: batch[0].seq,
      to: batch[batch.length - 1].seq,
      cid: box.cid,
      seen_rev: this.appliedThrough,
      shas: batch.map((entry) => entry.sha),
    }
    const body = encodePush(header, Y.mergeUpdates(batch.map((entry) => entry.bytes)))
    this.setSaveState('saving')
    this.inFlight = Promise.resolve()
      .then(() => this.options.endpoints.push(body, request))
      .then(
        (answer) => this.settle(answer, box, header.to),
        () => {
          this.unreachable()
          this.retryAfter(backoff())
        },
      )
      .finally(() => {
        this.inFlight = null
        if (this.saveState !== 'failed' || (this.blocked && !this.unsent)) {
          this.setSaveState(this.unsent ? 'unsaved' : 'clean')
        }
      })
    return this.inFlight
  }

  private async settle(answer: Answer, box: Outbox, to: number) {
    const body = json(answer)
    if (answer.status !== 423) this.pause(null)
    if (answer.status === 200) {
      this.heard()
      this.ack(box, body?.dup ? body.acked : to)
      if (body?.head > this.appliedThrough) void this.pull()
      if (this.unsent) this.scheduleSend()
      return
    }
    if (answer.status === 409 && body?.collab === 'seq' && typeof body.acked === 'number') {
      // The server lost seqs it already acknowledged, so resending can't restore them
      if (body.acked < box.acked) return this.die('seq')
      this.ack(box, body.acked)
      if (box.pending.length && box.pending[0].seq !== box.acked + 1) return this.die('seq')
      return this.retryAfter(0)
    }
    if (answer.status === 423) {
      this.pause(body?.reason ?? body?.collab ?? 'busy')
      return this.retryAfter(body?.retry_ms ?? 1000)
    }
    const blocked = this.refused(answer, 'lost_edit')
    if (blocked && recoverable(blocked)) return this.retryAfter(backoff())
    if (blocked) return
    if (!body?.collab) return this.retryAfter(backoff())
    await this.die(body.collab)
  }

  // A refusal about who is asking, or a lost right once the signed-in person is confirmed unchanged
  private refused(answer: Answer, lost: 'lost_edit' | 'lost_read'): Blocked | null {
    const reason = reasonOf(answer)
    let blocked: Blocked | null = null
    if (answer.status === 401 && (reason === 'signed_out' || reason === 'locked')) blocked = reason
    else if (staleSession(answer)) blocked = 'stale_session'
    else if (answer.status === 409 && reason === 'principal_changed') blocked = 'other_user'
    else if (answer.status === 403 || answer.status === 404) blocked = this.reconcile(lost)
    if (blocked) this.block(blocked)
    return blocked
  }

  private reconcile(lost: Blocked): Blocked {
    const now = this.options.signedIn()
    if (now === 'Guest') return 'signed_out'
    return now === this.options.principal ? lost : 'other_user'
  }

  // A lost right keeps the unsent work only as a recovery copy; another person's or a stale sign-in leaves it for a later tab
  private block(reason: Blocked) {
    if (this.blocked === reason || (this.blocked && !replaces(reason, this.blocked))) return
    if (!recoverable(reason)) {
      this.writable = false
      if (this.unsent) this.saveState = 'failed'
      if (reason === 'lost_edit' || reason === 'lost_read') void this.toRecovery('lost_access')
    }
    this.blocked = reason
    this.changed()
  }

  // The work this tab holds can never be committed: keep it as a recovery copy and stop
  private async die(reason: string) {
    this.writable = false
    this.setSaveState('failed')
    this.changed()
    await this.toRecovery(reason)
  }

  private async toRecovery(reason: string) {
    if (this.dead) return
    this.dead = reason
    if (!this.device) return
    const { store, doc: key } = this.device
    for (const box of this.outboxes()) {
      const entries = box.pending.map((entry) => ({ doc: key, sid: box.sid, ...entry }))
      await store.recover(key, box.sid, reason, entries).catch(() => {})
    }
  }

  // Without a device store nothing typed offline would survive the tab, so editing stops until the server answers
  private unreachable() {
    if (this.device) {
      if (this.unsent) this.persist()
    } else if (!this.blocked) {
      this.block('offline')
    }
  }

  private lostStore() {
    if (!this.device) return
    this.device = null
    this.changed()
  }

  private persist() {
    if (this.persisted || !this.device) return
    this.persisted = true
    void globalThis.navigator?.storage?.persist?.().catch(() => {})
  }

  private pause(reason: string | null) {
    if (this.paused === reason) return
    this.paused = reason
    this.changed()
  }

  private heard() {
    if (!this.blocked || !recoverable(this.blocked)) return
    this.blocked = null
    this.changed()
    if (this.retrying) {
      this.endRetry?.()
      void this.send()
    }
  }

  private ack(box: Outbox, through: number) {
    box.acked = Math.max(box.acked, through)
    const committed = box.pending.filter((entry) => entry.seq <= box.acked)
    if (!committed.length) return
    box.pending = box.pending.filter((entry) => entry.seq > box.acked)
    if (this.device) {
      const bytes = Y.mergeUpdates(committed.map((entry) => entry.bytes))
      void this.device.store.ack(this.device.doc, box.sid, box.acked, bytes).catch(() => {})
      if (box !== this.own && !box.pending.length) {
        void this.device.store.forget(this.device.doc, box.sid).catch(() => {})
        box.release()
        this.adopted = this.adopted.filter((other) => other !== box)
      }
    }
    this.counted()
  }

  private counted() {
    const unsent = this.unsent
    if (!unsent) this.unsentSince = 0
    else if (!this.unsentSince) this.unsentSince = Date.now()
    this.changed()
  }

  private session(): StoredSession {
    return { doc: this.device!.doc, sid: this.own.sid, lineage: this.lineage, cid: this.own.cid, bound: this.bound }
  }

  private outboxes() {
    return [...this.adopted, this.own]
  }

  private lockName(sid: string) {
    return `suite-collab:${this.device?.doc}:${sid}`
  }

  private retryAfter(ms: number) {
    if (this.closed) return
    this.endRetry?.()
    this.retrying = new Promise((resolve) => {
      this.endRetry = () => {
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = this.retrying = this.endRetry = null
        resolve()
      }
      this.retryTimer = setTimeout(() => {
        this.endRetry?.()
        void this.send()
      }, ms)
    })
  }

  private clearTimers() {
    if (this.sendTimer) clearTimeout(this.sendTimer)
    this.sendTimer = null
    this.endRetry?.()
  }

  private setSaveState(state: SaveState) {
    if (this.saveState === state) return
    this.saveState = state
    this.changed()
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }
}

// Losing edit access can still turn out to be losing read access or a switched account
function replaces(next: Blocked, current: Blocked) {
  return recoverable(current) || (current === 'lost_edit' && (next === 'lost_read' || next === 'other_user'))
}

// Web Locks only cut duplicate sends between tabs; where they are missing, every session counts as free
function holdLock(name: string): Promise<(() => void) | null> {
  const locks = globalThis.navigator?.locks
  if (!locks) return Promise.resolve(() => {})
  return new Promise((resolve) => {
    void locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(null)
        return new Promise<void>((release) => resolve(release))
      })
      .catch(() => resolve(() => {}))
  })
}

const lost = (verdict: string) => (verdict === 'clash' ? 'id_clash' : verdict)

const backoff = () => 1000 + Math.random() * 29_000

function json(answer: Answer): any {
  try {
    return JSON.parse(new TextDecoder().decode(answer.bytes))
  } catch {
    return null
  }
}

function openError(answer: Answer, options: OpenOptions) {
  if (staleSession(answer)) return new CollabOpenError(answer.status, 'stale_session')
  const reason = reasonOf(answer)
  if (answer.status !== 403 && answer.status !== 404) return new CollabOpenError(answer.status, reason)
  const now = options.signedIn()
  if (now === 'Guest') return new CollabOpenError(401, 'signed_out')
  return new CollabOpenError(answer.status, now === options.principal ? reason : 'principal_changed')
}

function reasonOf(answer: Answer): string | null {
  const body = json(answer)
  return typeof body?.collab === 'string' ? body.collab : null
}

// Frappe refuses a token from before the browser signed in again; only a reload brings the new one
function staleSession(answer: Answer) {
  return answer.status === 400 && json(answer)?.exc_type === 'CSRFTokenError'
}

function randomHex(bytes: number) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)))
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
