import * as Y from 'yjs'

import { readReply, staleSession, type Reply } from './answers'
import { decodeFrame, encodePush, type Limits, type PullHeader, type Row } from './frames'
import { holdLock, MAX_KEEPALIVE_BYTES, MAX_PUSH_BYTES, Outbox } from './outbox'
import { PIECE_BYTES, putPieces, stageFor, type Staging } from './pieces'
import type { DeviceStore, StoredSession } from './store'
import {
  recoverable,
  type Answer,
  type Blocked,
  type CollabRoom,
  type OpenOptions,
  type SaveState,
} from './types'

// Updates applied from the server; everything else in the doc is this tab's own work
export const REMOTE = Symbol('collab-remote')
// Another tab's unsent work, applied here so this tab shows and sends it
const ADOPT = Symbol('collab-adopt')

const PERSIST_AFTER_MS = 60_000
const STRIKE_WINDOW_MS = 10 * 60_000
const STRIKES = 3

// When rows were judged clean and still failed to apply in this page, per lineage
const strikes = new Map<string, number[]>()

export interface RoomInit {
  doc: Y.Doc
  lineage: string
  // The last quarantine this copy was built after
  epoch: number
  canWrite: boolean
  sid: string
  // False while a clientID chosen offline waits for the server to accept it
  bound: boolean
}

// What a room opens on: the checkpoint covering revs through `base`, then the rows after it
export interface Opening {
  base: number
  schema?: number
  checkpoint: Uint8Array | null
  rows: Row[]
  limits?: Limits
}

export class Room implements CollabRoom {
  readonly doc: Y.Doc
  blocked: Blocked | null = null
  paused: string | null = null
  held: string | null = null
  newerSchema = false
  appliedThrough = 0
  limits: Limits | null = null
  needsRebuild = false
  private readonly lineage: string
  private readonly epoch: number
  private writable: boolean
  private bound: boolean
  private readonly own: Outbox
  // Tabs' leftovers come first and this tab's own stays last
  private boxes: Outbox[]
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
  // Set once this tab's work can never be committed; the reason it was kept as a recovery copy
  private dead: string | null = null
  private failed = false
  private unheard = false
  private persisted = false
  private device: { store: DeviceStore; doc: string } | null
  // A row failed to apply here: the rev reported, and the `judged` count its verdict comes after
  private judging: { rev: number; seen: number | null } | null = null
  private reportTimer: ReturnType<typeof setTimeout> | null = null
  private staging: Staging | null = null

  constructor(
    init: RoomInit,
    private readonly options: OpenOptions,
  ) {
    this.doc = init.doc
    this.lineage = init.lineage
    this.epoch = init.epoch
    this.writable = init.canWrite
    this.bound = init.bound
    this.device = options.device ?? null
    this.own = new Outbox(init.sid, init.doc.clientID, () => {})
    this.boxes = [this.own]
  }

  async start(opening: Opening) {
    this.doc.on('update', this.capture)
    if (this.device && this.writable && this.bound) {
      await this.device.store.saveSession(this.session()).catch(() => this.lostStore())
    }
    this.own.release = (await holdLock(this.lockName(this.own.sid))) ?? (() => {})
    this.appliedThrough = opening.base
    this.limits = opening.limits ?? null
    this.follow(opening.schema)
    this.apply(opening.rows, opening)
    if (this.writable) await this.adopt()
    this.pollTimer = setInterval(() => void this.tick(), this.options.pollMs ?? 2000)
    document.addEventListener('visibilitychange', this.hidden)
    window.addEventListener('pagehide', this.sendNow)
  }

  get canWrite() {
    return this.writable && !this.judging && !this.held
  }

  get stopped() {
    return this.dead
  }

  get onDevice() {
    return !!this.device
  }

  get unsent() {
    return this.boxes.reduce((sum, box) => sum + box.pending.length, 0)
  }

  // A stopped tab stays failed while it holds work; once a refusal leaves nothing unsent there is nothing to fail
  get saveState(): SaveState {
    if (this.failed && !(this.blocked && !this.unsent)) return 'failed'
    if (this.inFlight) return 'saving'
    return this.unsent ? 'unsaved' : 'clean'
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  pull(): Promise<void> {
    if (
      this.closed ||
      this.needsRebuild ||
      this.blocked === 'other_user' ||
      this.blocked === 'lost_read'
    )
      return Promise.resolve()
    if (!this.bound) return this.dead ? Promise.resolve() : this.connect()
    return this.connecting ?? this.fetch()
  }

  private fetch(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.pulling ??= this.options.endpoints
      .pull(this.appliedThrough, this.epoch)
      .then((answer) => {
        if (answer.status !== 200) {
          this.refused(readReply(answer), 'lost_read')
          return
        }
        const { header, rows } = decodeFrame<PullHeader>(answer.bytes)
        this.heard()
        if (header.limits) this.limits = header.limits
        if (header.state === 'rebuild') return this.outdated()
        this.hold(header.held ?? null)
        if (!this.follow(header.schema)) return
        if (this.judging) return this.judged(header)
        this.apply(rows)
      })
      .catch(() => this.unreachable())
      .finally(() => (this.pulling = null))
    return this.pulling
  }

  // Waits out each retry delay rather than pushing again at once
  async flush() {
    while (
      !this.closed &&
      this.bound &&
      !this.judging &&
      (this.inFlight || this.unsent) &&
      this.saveState !== 'failed'
    ) {
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
    document.removeEventListener('visibilitychange', this.hidden)
    window.removeEventListener('pagehide', this.sendNow)
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.clearTimers()
    this.doc.off('update', this.capture)
    this.listeners.clear()
    for (const box of this.boxes) box.release()
    if (this.device && !this.own.pending.length && !this.dead) {
      void this.device.store.release(this.device.doc, this.own.sid).catch(() => {})
    }
  }

  private tick() {
    if (this.unsent && this.unsentSince && Date.now() - this.unsentSince > PERSIST_AFTER_MS)
      this.persist()
    void this.pull()
  }

  // Claim the clientID chosen offline, send what was typed, and only then take anyone else's rows
  private connect(): Promise<void> {
    this.connecting ??= this.claim(this.own)
      .then(async (answer) => {
        if (answer === null || this.closed) return
        if (answer !== 'ok') {
          // Other tabs' work never used this clientID, so a later tab can still send it
          for (const box of this.boxes) if (box.adopted) box.release()
          this.boxes = [this.own]
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
      answer = await this.options.endpoints.session(box.sid, {
        cid: box.cid,
        lineage: this.lineage,
      })
    } catch {
      this.unreachable()
      return null
    }
    const reply = readReply(answer)
    if (reply.status === 200 && typeof reply.claim === 'string') {
      if (reply.claim === 'ok' && this.device) {
        const session = {
          doc: this.device.doc,
          sid: box.sid,
          lineage: this.lineage,
          cid: box.cid,
          bound: true,
        }
        await this.device.store.saveSession(session).catch(() => {})
      }
      return reply.claim
    }
    return this.refused(reply, 'lost_edit') ? null : (reply.collab ?? null)
  }

  // Unsent work other tabs of this document left on the device, once no live tab holds it
  private async adopt() {
    if (!this.device || this.dead) return
    const { store, doc: key } = this.device
    const sessions = await store.sessions(key).catch(() => [])
    for (const session of sessions) {
      if (this.boxes.some((box) => box.sid === session.sid)) continue
      if (!session.bound && !this.bound) continue
      const release = await holdLock(this.lockName(session.sid))
      if (!release) continue
      if (this.closed) return release()
      const entries = await store.entries(key, session.sid).catch(() => [])
      if (!entries.length) {
        await store.release(key, session.sid).catch(() => {})
        release()
        continue
      }
      const box = new Outbox(session.sid, session.cid, release, true, entries)
      const verdict =
        session.lineage !== this.lineage ? 'lineage' : session.bound ? 'ok' : await this.claim(box)
      if (this.closed) return release()
      if (verdict !== 'ok') {
        if (verdict) await store.recover(key, session.sid, lost(verdict)).catch(() => {})
        release()
        continue
      }
      Y.applyUpdate(this.doc, Y.mergeUpdates(box.pending.map((entry) => entry.bytes)), ADOPT)
      this.boxes.splice(-1, 0, box)
    }
    this.counted()
    if (this.unsent && this.bound) this.scheduleSend()
  }

  // Rows are applied strictly in rev order; a hole waits for the next pull
  private apply(rows: Row[], opening?: Opening) {
    const next = rows.filter((row) => row.rev > this.appliedThrough).sort((a, b) => a.rev - b.rev)
    const run: Row[] = []
    for (const row of next) {
      if (row.rev !== this.appliedThrough + run.length + 1) break
      run.push(row)
    }
    if (!run.length && !opening) return
    // An empty row is a quarantined rev: it holds its place in the order and applies nothing
    const parts = [
      ...(opening?.checkpoint ? [opening.checkpoint] : []),
      ...run.filter((row) => row.bytes.length).map((row) => row.bytes),
    ]
    let bytes: Uint8Array | null = null
    try {
      bytes = parts.length ? Y.mergeUpdates(parts) : null
      if (bytes) Y.applyUpdate(this.doc, bytes, REMOTE)
    } catch {
      // Yjs keeps what it applied, so this copy follows nothing more until the server judges the rows
      return this.suspect(run.at(-1)?.rev ?? this.appliedThrough)
    }
    if (run.length) this.appliedThrough = run[run.length - 1].rev
    if (this.device) {
      const copy = {
        lineage: this.lineage,
        rev: this.appliedThrough,
        canWrite: this.writable,
        epoch: this.epoch,
      }
      void this.device.store.commit(this.device.doc, copy, bytes).catch(() => {})
    }
    if (bytes) this.changed()
  }

  private suspect(rev: number) {
    this.judging = { rev, seen: null }
    this.pause('suspect')
    void this.report()
  }

  private async report() {
    const judging = this.judging
    if (!judging || this.closed) return
    let reply: Reply
    try {
      reply = readReply(await this.options.endpoints.suspect(judging.rev))
    } catch {
      this.unreachable()
      return this.reportAfter(backoff())
    }
    if (reply.status === 202 && typeof reply.judged === 'number') judging.seen = reply.judged
    else if (reply.status === 423) {
      if (reply.reason === 'suspect') this.hold(this.held ?? 'change')
      this.reportAfter(reply.retry_ms ?? 1000)
    } else if (!this.refused(reply, 'lost_read')) await this.verdict(reply.verdict ?? 'unjudged')
  }

  private reportAfter(ms: number) {
    if (this.closed) return
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null
      void this.report()
    }, ms)
  }

  private async judged(header: PullHeader) {
    const judging = this.judging!
    if (judging.seen === null || (header.judged ?? 0) <= judging.seen) return
    judging.seen = header.judged!
    await this.verdict(header.verdict ?? 'unjudged')
  }

  // A held document waits for an admin. Anything but a quarantine means this browser failed on rows the server takes
  private async verdict(verdict: string) {
    if (verdict === 'held') return
    if (verdict !== 'quarantined' && strike(this.lineage) >= STRIKES) return this.die('browser')
    this.outdated()
  }

  private capture = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || origin === ADOPT || this.closed) return
    // The editor turns read-only a moment after the verdict, so typing can still arrive
    if (this.dead) {
      if (!this.device) return
      const entry = this.own.mint(update)
      void this.device.store
        .recover(
          this.device.doc,
          this.own.sid,
          this.dead,
          this.own.stored(this.device.doc, [entry]),
        )
        .catch(() => {})
      return
    }
    if (!this.writable) return
    const entry = this.own.add(update)
    if (this.device) {
      void this.device.store
        .capture(this.session(), this.own.stored(this.device.doc, [entry]))
        .catch(() => this.lostStore())
    }
    this.counted()
    if (this.bound) this.scheduleSend()
    else this.persist()
  }

  private hidden = () => {
    if (document.visibilityState === 'hidden') this.sendNow()
  }

  // A hidden or departing page may never run its send timer, its retry, or hear back from a save on its way
  private sendNow = () => {
    if (this.sendTimer) clearTimeout(this.sendTimer)
    this.sendTimer = null
    if (this.inFlight) {
      const copy = this.batch(true)
      if (copy && !copy.pieces)
        void this.options.endpoints.push(copy.body, { keepalive: true }).catch(() => {})
      return
    }
    this.endRetry?.()
    void this.send({ keepalive: true })
  }

  private scheduleSend() {
    const now = Date.now()
    if (!this.sendTimer) this.firstUnsentAt = now
    else clearTimeout(this.sendTimer)
    const delay = Math.min(
      this.options.sendDelayMs ?? 1000,
      this.firstUnsentAt + (this.options.sendMaxDelayMs ?? 3000) - now,
    )
    this.sendTimer = setTimeout(
      () => {
        this.sendTimer = null
        void this.send()
      },
      Math.max(0, delay),
    )
  }

  private batch(keepalive?: boolean) {
    const box = this.boxes.find((other) => other.pending.length) ?? this.own
    const held = this.closed || !this.bound || this.judging || this.saveState === 'failed'
    if (!box.pending.length || held) return null
    const batch = box.batch(keepalive ? MAX_KEEPALIVE_BYTES : MAX_PUSH_BYTES)
    const header = {
      proto: 1,
      lineage: this.lineage,
      principal: this.options.principal,
      schema: this.options.schema,
      sid: box.sid,
      from: batch[0].seq,
      to: batch[batch.length - 1].seq,
      cid: box.cid,
      seen_rev: this.appliedThrough,
      shas: batch.map((entry) => entry.sha),
      // The tab is hiding or closing, so the server may compact now
      final: !!keepalive,
    }
    const update = Y.mergeUpdates(batch.map((entry) => entry.bytes))
    if (update.byteLength <= PIECE_BYTES) return { box, header, body: encodePush(header, update) }
    // Staged pieces take several requests, which a departing page can't count on
    this.staging = stageFor(this.staging, header)
    const staged = { ...header, final: false, stage_id: this.staging.id }
    const pieces = { stage: this.staging.id, update }
    return { box, header: staged, body: encodePush(staged, new Uint8Array()), pieces }
  }

  private send(request: { keepalive?: boolean } = {}): Promise<void> {
    if (this.inFlight || this.retrying) return this.inFlight ?? this.retrying!
    const next = this.batch(request.keepalive)
    if (!next) return Promise.resolve()
    const { box, header, body, pieces } = next
    const { endpoints } = this.options
    this.inFlight = Promise.resolve()
      .then(async () => {
        const refused = pieces && (await putPieces(endpoints, pieces.stage, header, pieces.update))
        return refused || readReply(await endpoints.push(body, pieces ? {} : request))
      })
      .then(
        (reply) => this.settle(reply, box, header.to),
        () => {
          this.unreachable()
          this.retryAfter(backoff())
        },
      )
      .finally(() => {
        this.inFlight = null
        this.changed()
      })
    this.changed()
    return this.inFlight
  }

  private async settle(reply: Reply, box: Outbox, to: number) {
    if (reply.status !== 423) this.pause(null)
    if (reply.status === 200) {
      this.heard()
      this.ack(box, reply.dup ? (reply.acked ?? to) : to)
      if ((reply.head ?? 0) > this.appliedThrough) void this.pull()
      if (this.unsent) this.scheduleSend()
      return
    }
    if (reply.status === 409 && reply.collab === 'seq' && typeof reply.acked === 'number') {
      // The server lost seqs it already acknowledged, so resending can't restore them
      if (reply.acked < box.acked) return this.die('seq')
      this.ack(box, reply.acked)
      if (box.gap) return this.die('seq')
      return this.retryAfter(0)
    }
    // Pieces the server dropped or never got are staged again; a stage it refused is replaced
    if (
      reply.status === 409 &&
      (reply.collab === 'stage_conflict' || reply.collab === 'stage_incomplete')
    ) {
      if (reply.collab === 'stage_conflict') this.staging = null
      return this.retryAfter(backoff())
    }
    if (reply.status === 423) {
      if (reply.reason === 'suspect') this.hold(this.held ?? 'change')
      this.pause(reply.reason ?? reply.collab ?? 'busy')
      return this.retryAfter(reply.retry_ms ?? 1000)
    }
    const blocked = this.refused(reply, 'lost_edit')
    if (blocked && recoverable(blocked)) return this.retryAfter(backoff())
    if (blocked) return
    if (!reply.collab) return this.retryAfter(backoff())
    await this.die(reply.collab)
    // The server quarantined a change of this session, which this copy still holds
    if (reply.collab === 'client_closed') this.outdated()
  }

  // A refusal about who is asking, or a lost right once the signed-in person is confirmed unchanged
  private refused(reply: Reply, lost: 'lost_edit' | 'lost_read'): Blocked | null {
    let blocked: Blocked | null = null
    if (reply.status === 401 && (reply.collab === 'signed_out' || reply.collab === 'locked'))
      blocked = reply.collab
    else if (staleSession(reply)) blocked = 'stale_session'
    else if (reply.status === 409 && reply.collab === 'principal_changed') blocked = 'other_user'
    else if (reply.status === 403 || reply.status === 404) blocked = this.reconcile(lost)
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
      if (this.unsent) this.failed = true
      if (reason === 'lost_edit' || reason === 'lost_read') void this.toRecovery('lost_access')
    }
    this.blocked = reason
    this.changed()
  }

  // The work this tab holds can never be committed: keep it as a recovery copy and stop
  private async die(reason: string) {
    this.writable = false
    this.failed = true
    const kept = this.toRecovery(reason)
    this.changed()
    await kept
  }

  private async toRecovery(reason: string) {
    if (this.dead) return
    this.dead = reason
    if (!this.device) return
    const { store, doc: key } = this.device
    for (const box of this.boxes)
      await store.recover(key, box.sid, reason, box.stored(key)).catch(() => {})
  }

  // Without a device store nothing typed offline would survive the tab, so editing stops until the server answers
  private unreachable() {
    this.unheard = true
    if (this.device) {
      if (this.unsent) this.persist()
    } else if (!this.blocked) {
      this.block('offline')
    }
  }

  private outdated() {
    if (this.needsRebuild) return
    this.needsRebuild = true
    this.changed()
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

  // An editor older than the document's rows may drop what it can't show; nothing it does from now on is sent.
  // Work typed before still goes out, as the server takes older schemas
  private follow(schema = 0) {
    if (schema <= this.options.schema || this.newerSchema) return !this.newerSchema
    this.newerSchema = true
    this.writable = false
    this.changed()
    return false
  }

  // A held document's pushes wait minutes between tries, so its release sends at once
  private hold(held: string | null) {
    if (this.held === held) return
    const released = !held
    this.held = held
    this.changed()
    if (released && this.retrying) {
      this.endRetry?.()
      void this.send()
    }
  }

  // Work held while the server was out of reach goes out on the first answer, not after the retry wait
  private heard() {
    const wasUnheard = this.unheard
    this.unheard = false
    if (this.blocked && !recoverable(this.blocked)) return
    const wasBlocked = this.blocked !== null
    if (wasBlocked) {
      this.blocked = null
      this.changed()
    }
    if ((wasBlocked || wasUnheard) && this.retrying) {
      this.endRetry?.()
      void this.send()
    }
  }

  private ack(box: Outbox, through: number) {
    const committed = box.ack(through)
    if (!committed) return
    if (this.device) {
      void this.device.store
        .ack(this.device.doc, box.sid, box.acked, committed, this.lineage, this.epoch)
        .catch(() => {})
      if (box.adopted && !box.pending.length) {
        void this.device.store.release(this.device.doc, box.sid).catch(() => {})
        box.release()
        this.boxes = this.boxes.filter((other) => other !== box)
      }
    }
    this.counted()
  }

  private counted() {
    if (!this.unsent) this.unsentSince = 0
    else if (!this.unsentSince) this.unsentSince = Date.now()
    this.changed()
  }

  private session(): StoredSession {
    return {
      doc: this.device!.doc,
      sid: this.own.sid,
      lineage: this.lineage,
      cid: this.own.cid,
      bound: this.bound,
    }
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
    if (this.reportTimer) clearTimeout(this.reportTimer)
    this.sendTimer = this.reportTimer = null
    this.endRetry?.()
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }
}

// Losing edit access can still turn out to be losing read access or a switched account
function replaces(next: Blocked, current: Blocked) {
  return (
    recoverable(current) ||
    (current === 'lost_edit' && (next === 'lost_read' || next === 'other_user'))
  )
}

const lost = (verdict: string) => (verdict === 'clash' ? 'id_clash' : verdict)

function strike(lineage: string) {
  const now = Date.now()
  const recent = (strikes.get(lineage) ?? []).filter((at) => now - at < STRIKE_WINDOW_MS)
  recent.push(now)
  strikes.set(lineage, recent)
  return recent.length
}

const backoff = () => 1000 + Math.random() * 29_000
