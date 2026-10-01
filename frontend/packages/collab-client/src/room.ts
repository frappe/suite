import * as Y from 'yjs'
import { decodeFrame, encodePush, type FrameHeader, type OpenState, type Row } from './frames'

export interface Answer {
  status: number
  bytes: Uint8Array
}

// The product's routes for one document. Each answers every status as it came;
// a network failure throws
export interface CollabEndpoints {
  open(): Promise<Answer>
  pull(since: number): Promise<Answer>
  push(body: Uint8Array<ArrayBuffer>, options?: { keepalive?: boolean }): Promise<Answer>
  session(sid: string): Promise<Answer>
}

export interface OpenOptions {
  endpoints: CollabEndpoints
  principal: string
  // Who the browser is signed in as now, or 'Guest'
  signedIn: () => string
  pollMs?: number
  sendDelayMs?: number
  sendMaxDelayMs?: number
}

export type SaveState = 'clean' | 'saving' | 'unsaved' | 'failed'

// Why the server stopped hearing this tab. Only `signed_out` and `locked` clear, once the server hears it again
export type Blocked = 'signed_out' | 'locked' | 'stale_session' | 'other_user' | 'lost_edit' | 'lost_read'

export const recoverable = (blocked: Blocked) => blocked === 'signed_out' || blocked === 'locked'

export interface CollabRoom {
  readonly doc: Y.Doc
  readonly canWrite: boolean
  readonly blocked: Blocked | null
  readonly saveState: SaveState
  readonly unsent: number
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

const MAX_ENTRIES = 128
const MAX_PUSH_BYTES = 256 * 1024
// Browsers refuse keepalive bodies over 64 KiB
const MAX_KEEPALIVE_BYTES = 60 * 1024

type Entry = { seq: number; bytes: Uint8Array }

export async function openCollabRoom(options: OpenOptions): Promise<Opened> {
  const { endpoints } = options
  const opened = await endpoints.open()
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
  return { state: 'live', room: new Room(doc, header, rows, canWrite, sid, options) }
}

class Room implements CollabRoom {
  saveState: SaveState = 'clean'
  blocked: Blocked | null = null
  appliedThrough = 0
  private pending: Entry[] = []
  private nextSeq = 1
  private acked = 0
  private inFlight: Promise<void> | null = null
  private pulling: Promise<void> | null = null
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private firstUnsentAt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retrying: Promise<void> | null = null
  private endRetry: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval>
  private listeners = new Set<() => void>()
  private closed = false
  private readonly lineage: string

  constructor(
    readonly doc: Y.Doc,
    header: FrameHeader,
    rows: Row[],
    private writable: boolean,
    private readonly sid: string,
    private readonly options: OpenOptions,
  ) {
    this.lineage = header.lineage!
    doc.on('update', this.capture)
    this.apply(rows)
    this.pollTimer = setInterval(() => void this.pull(), options.pollMs ?? 2000)
  }

  get canWrite() {
    return this.writable
  }

  get unsent() {
    return this.pending.length
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  pull(): Promise<void> {
    if (this.closed || this.blocked === 'other_user' || this.blocked === 'lost_read') return Promise.resolve()
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
      .catch(() => {})
      .finally(() => (this.pulling = null))
    return this.pulling
  }

  // Waits out each retry delay rather than pushing again at once
  async flush() {
    while (!this.closed && (this.inFlight || this.pending.length) && this.saveState !== 'failed') {
      await (this.inFlight ?? this.retrying ?? this.send())
    }
  }

  async close() {
    if (this.closed) return
    if (this.inFlight) await this.inFlight
    if (this.pending.length && this.saveState !== 'failed') {
      this.clearTimers()
      await this.send({ keepalive: true })
    }
    this.closed = true
    clearInterval(this.pollTimer)
    this.clearTimers()
    this.doc.off('update', this.capture)
    this.listeners.clear()
  }

  // Rows are applied strictly in rev order; a hole waits for the next pull
  private apply(rows: Row[]) {
    const next = rows.filter((row) => row.rev > this.appliedThrough).sort((a, b) => a.rev - b.rev)
    const run: Row[] = []
    for (const row of next) {
      if (row.rev !== this.appliedThrough + run.length + 1) break
      run.push(row)
    }
    if (!run.length) return
    Y.applyUpdate(this.doc, Y.mergeUpdates(run.map((row) => row.bytes)), REMOTE)
    this.appliedThrough = run[run.length - 1].rev
    this.changed()
  }

  private capture = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || !this.writable || this.closed) return
    this.pending.push({ seq: this.nextSeq++, bytes: update })
    if (this.saveState !== 'failed') this.setSaveState(this.inFlight ? 'saving' : 'unsaved')
    this.scheduleSend()
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
    if (this.inFlight || this.retrying || !this.pending.length || this.closed || this.saveState === 'failed') {
      return this.inFlight ?? this.retrying ?? Promise.resolve()
    }
    const batch: Entry[] = []
    let size = 0
    const maxBytes = request.keepalive ? MAX_KEEPALIVE_BYTES : MAX_PUSH_BYTES
    for (const entry of this.pending) {
      if (batch.length && (batch.length >= MAX_ENTRIES || size + entry.bytes.byteLength > maxBytes)) break
      batch.push(entry)
      size += entry.bytes.byteLength
    }
    const header = {
      proto: 1,
      lineage: this.lineage,
      principal: this.options.principal,
      sid: this.sid,
      from: batch[0].seq,
      to: batch[batch.length - 1].seq,
      cid: this.doc.clientID,
      seen_rev: this.appliedThrough,
    }
    const body = encodePush(header, Y.mergeUpdates(batch.map((entry) => entry.bytes)))
    this.setSaveState('saving')
    this.inFlight = Promise.resolve()
      .then(() => this.options.endpoints.push(body, request))
      .then((answer) => this.settle(answer, header.to), () => this.retryAfter(backoff()))
      .finally(() => {
        this.inFlight = null
        if (this.saveState !== 'failed') this.setSaveState(this.pending.length ? 'unsaved' : 'clean')
      })
    return this.inFlight
  }

  private settle(answer: Answer, to: number) {
    const body = json(answer)
    if (answer.status === 200) {
      this.heard()
      this.ack(body?.dup ? body.acked : to)
      if (body?.head > this.appliedThrough) void this.pull()
      if (this.pending.length) this.scheduleSend()
      return
    }
    if (answer.status === 409 && body?.collab === 'seq' && typeof body.acked === 'number') {
      this.ack(body.acked)
      if (this.pending.length && this.pending[0].seq !== this.acked + 1) this.setSaveState('failed')
      else this.retryAfter(0)
      return
    }
    if (answer.status === 423) return this.retryAfter(body?.retry_ms ?? 1000)
    const blocked = this.refused(answer, 'lost_edit')
    if (blocked && recoverable(blocked)) return this.retryAfter(backoff())
    if (blocked) return
    if (!body?.collab) return this.retryAfter(backoff())
    this.setSaveState('failed')
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

  private block(reason: Blocked) {
    if (this.blocked === reason || (this.blocked && !replaces(reason, this.blocked))) return
    if (!recoverable(reason)) {
      this.writable = false
      if (this.pending.length) this.saveState = 'failed'
    }
    this.blocked = reason
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

  private ack(through: number) {
    this.acked = Math.max(this.acked, through)
    this.pending = this.pending.filter((entry) => entry.seq > this.acked)
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
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
