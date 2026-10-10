import * as Y from 'yjs'

import { isStaleSession, readReply, type Reply } from './answers'
import {
  decodeFrame,
  encodePush,
  type Limits,
  type PullHeader,
  type RoomKeys,
  type Row,
} from './frames'
import { Live, type LiveHooks } from './live'
import { holdLock, MAX_KEEPALIVE_BYTES, MAX_PUSH_BYTES, Outbox } from './outbox'
import { PIECE_BYTES, putPieces, stageFor, type Staging } from './pieces'
import type { DeviceStore, StoredSession } from './store'
import {
  isRecoverable,
  type Answer,
  type Blocked,
  type Claim,
  type CollabRoom,
  type LiveState,
  type OpenOptions,
  type SaveState,
} from './types'

// Updates applied from the server; everything else in the doc is this tab's own work
export const REMOTE = Symbol('collab-remote')
// Another tab's unsent work, applied here so this tab shows and sends it
const ADOPT = Symbol('collab-adopt')

const PERSIST_AFTER_MS = 60_000
const STRIKE_WINDOW_MS = 10 * 60_000
const MAX_STRIKES = 3
// Without live updates a tab pulls every tick while others are editing or work waits, and every sixth tick otherwise
const QUIET_TICKS = 6
const CO_EDITING_MS = 60_000
// Rows heard ahead of a missing one wait for it, up to this many
const WAITING_MAX = 256

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
  rooms?: RoomKeys
  // Opened from the device copy, so the server hasn't answered yet
  offline?: boolean
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
  private readonly ownOutbox: Outbox
  // Tabs' leftovers come first and this tab's own stays last
  private outboxes: Outbox[]
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
  private stopReason: string | null = null
  private failed = false
  private unheard = false
  private persisted = false
  private device: { store: DeviceStore; doc: string } | null
  // A row failed to apply here: the rev reported, and the `judged` count its verdict comes after
  private judging: { rev: number; seen: number | null } | null = null
  private reportTimer: ReturnType<typeof setTimeout> | null = null
  private staging: Staging | null = null
  private realtime: Live | null = null
  private readonly waitingRows = new Map<number, Row>()
  private ticks = 0
  private lastRemoteAt = 0

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
    this.ownOutbox = new Outbox(init.sid, init.doc.clientID, () => {})
    this.outboxes = [this.ownOutbox]
  }

  async start(opening: Opening) {
    this.doc.on('update', this.onDocUpdate)
    if (this.device && this.writable && this.bound) {
      const session = this.ownSession()
      await this.device.store.saveSession(session).catch(() => this.dropDeviceStore())
    }

    const ownLockName = this.lockName(this.ownOutbox.sid)
    const releaseOwnLock = await holdLock(ownLockName)
    this.ownOutbox.release = releaseOwnLock ?? (() => {})

    this.appliedThrough = opening.base
    this.unheard = !!opening.offline
    this.limits = opening.limits ?? null
    this.follow(opening.schema)
    this.applyRows(opening.rows, opening)
    if (this.writable) {
      await this.adoptLeftovers()
    }

    if (this.options.socket && !this.closed) {
      const liveHooks: LiveHooks = {
        heardRows: this.heardRows,
        pull: () => void this.pull(),
        changed: () => this.notifyListeners(),
        appliedThrough: () => this.appliedThrough,
        showsCaret: () => this.canWrite && this.bound && !this.closed,
      }
      this.realtime = new Live(this.options.socket, this.lineage, liveHooks)
      if (opening.rooms) {
        this.realtime.setRoomKeys(opening.rooms)
      }
    }

    this.pollTimer = setInterval(() => void this.tick(), this.options.pollMs ?? 5000)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('pagehide', this.sendNow)
  }

  get canWrite() {
    return this.writable && !this.judging && !this.held
  }

  get live(): LiveState | null {
    return this.realtime?.state ?? null
  }

  get presence() {
    return this.realtime?.presence ?? null
  }

  get stopped() {
    return this.stopReason
  }

  get onDevice() {
    return !!this.device
  }

  get atLimit() {
    const limits = this.limits
    if (!limits) return false

    return limits.state_bytes + limits.tail_bound >= limits.state_max
  }

  get unsent() {
    return this.outboxes.reduce((sum, box) => sum + box.pending.length, 0)
  }

  // A stopped tab stays failed while it holds work; once a refusal leaves nothing unsent there is nothing to fail
  get saveState(): SaveState {
    const refusedWithNothingUnsent = !!this.blocked && !this.unsent
    if (this.failed && !refusedWithNothingUnsent) return 'failed'

    if (this.inFlight) return 'saving'

    if (this.unsent) return 'unsaved'

    return 'clean'
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  pull(): Promise<void> {
    const readBlocked = this.blocked === 'other_user' || this.blocked === 'lost_read'
    if (this.closed || this.needsRebuild || readBlocked) return Promise.resolve()

    if (!this.bound) {
      if (this.stopReason) return Promise.resolve()

      return this.claimAndBind()
    }

    return this.connecting ?? this.pullNow()
  }

  private pullNow(): Promise<void> {
    if (this.closed) return Promise.resolve()

    const applyPull = (answer: Answer) => {
      if (answer.status !== 200) {
        const reply = readReply(answer)
        this.classifyRefusal(reply, 'lost_read')
        return
      }

      const { header, rows } = decodeFrame<PullHeader>(answer.bytes)
      this.onServerHeard()
      if (header.rooms) {
        this.realtime?.setRoomKeys(header.rooms)
      }
      if (header.limits) {
        this.updateLimits(header.limits)
      }
      if (header.state === 'rebuild') {
        return this.markNeedsRebuild()
      }

      this.setHeld(header.held ?? null)
      if (!this.follow(header.schema)) return

      if (this.judging) {
        return this.checkVerdict(header)
      }

      this.applyRows(rows)
    }
    this.pulling ??= this.options.endpoints
      .pull(this.appliedThrough, this.epoch)
      .then(applyPull)
      .catch(() => this.onUnreachable())
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

    if (this.inFlight) {
      await this.inFlight
    }
    if (this.bound && this.unsent && this.saveState !== 'failed') {
      this.clearTimers()
      await this.send({ keepalive: true })
    }

    this.closed = true
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('pagehide', this.sendNow)
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
    }
    this.realtime?.close()
    this.clearTimers()
    this.doc.off('update', this.onDocUpdate)
    this.listeners.clear()
    for (const box of this.outboxes) {
      box.release()
    }
    if (this.device && !this.ownOutbox.pending.length && !this.stopReason) {
      void this.device.store.release(this.device.doc, this.ownOutbox.sid).catch(() => {})
    }
  }

  private tick() {
    const unsentForLong = !!this.unsentSince && Date.now() - this.unsentSince > PERSIST_AFTER_MS
    if (this.unsent && unsentForLong) {
      this.requestPersistentStorage()
    }
    if (this.realtime?.live) return

    this.realtime?.reconnect()
    const coEditing =
      document.visibilityState === 'visible' && Date.now() - this.lastRemoteAt < CO_EDITING_MS
    // Work held while the server is out of reach goes out on the first tick that reaches it
    const hasWorkWaiting = this.unsent || this.unheard || !this.bound
    if (coEditing || hasWorkWaiting || ++this.ticks % QUIET_TICKS === 0) {
      void this.pull()
    }
  }

  // A row from the realtime service; one written by a newer editor is pulled, so the schema gate sees it
  private heardRows = (rows: Row[], schema = 0) => {
    const readBlocked = this.blocked === 'other_user' || this.blocked === 'lost_read'
    const following = !this.needsRebuild && !this.judging && !this.newerSchema
    if (this.closed || !this.bound || !following || readBlocked) return

    if (schema > this.options.schema) {
      void this.pull()
      return
    }

    for (const row of rows) {
      if (row.rev > this.appliedThrough && this.waitingRows.size < WAITING_MAX) {
        this.waitingRows.set(row.rev, row)
      }
    }
    this.applyRows([])
    if (this.waitingRows.size) {
      this.realtime?.pullHoleLater(() => this.waitingRows.size > 0)
    }
  }

  // Claim the clientID chosen offline, send what was typed, and only then take anyone else's rows
  private claimAndBind(): Promise<void> {
    const bindAfterClaim = async (answer: string | null) => {
      if (answer === null || this.closed) return

      if (answer !== 'ok') {
        // Other tabs' work never used this clientID, so a later tab can still send it
        for (const box of this.outboxes) {
          if (box.adopted) {
            box.release()
          }
        }
        this.outboxes = [this.ownOutbox]
        const reason = lostReason(answer)
        await this.stopForGood(reason)
        return
      }

      this.bound = true
      this.onServerHeard()
      await this.adoptLeftovers()
      await this.flush()
      await this.pullNow()
    }
    this.connecting ??= this.claimClientId(this.ownOutbox)
      .then(bindAfterClaim)
      .finally(() => (this.connecting = null))
    return this.connecting
  }

  // `null` when the claim got no verdict this time; a refusal with a reason is final
  private async claimClientId(box: Outbox): Promise<string | null> {
    const claim: Claim = {
      cid: box.cid,
      lineage: this.lineage,
    }
    let answer: Answer
    try {
      answer = await this.options.endpoints.session(box.sid, claim)
    } catch {
      this.onUnreachable()
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

    const blocked = this.classifyRefusal(reply, 'lost_edit')
    if (blocked) return null

    return reply.collab ?? null
  }

  // Unsent work other tabs of this document left on the device, once no live tab holds it
  private async adoptLeftovers() {
    if (!this.device || this.stopReason) return

    const { store, doc: docName } = this.device
    const sessions = await store.sessions(docName).catch(() => [])
    for (const session of sessions) {
      if (this.outboxes.some((box) => box.sid === session.sid)) continue
      if (!session.bound && !this.bound) continue

      const lockName = this.lockName(session.sid)
      const release = await holdLock(lockName)
      if (!release) continue
      if (this.closed) {
        return release()
      }

      const entries = await store.entries(docName, session.sid).catch(() => [])
      if (!entries.length) {
        await store.release(docName, session.sid).catch(() => {})
        release()
        continue
      }

      const box = new Outbox(session.sid, session.cid, release, true, entries)
      let claimVerdict: string | null = 'ok'
      if (session.lineage !== this.lineage) {
        claimVerdict = 'lineage'
      } else if (!session.bound) {
        claimVerdict = await this.claimClientId(box)
      }
      if (this.closed) {
        return release()
      }

      if (claimVerdict !== 'ok') {
        if (claimVerdict) {
          const reason = lostReason(claimVerdict)
          await store.recover(docName, session.sid, reason).catch(() => {})
        }
        release()
        continue
      }

      const pendingUpdates = box.pending.map((entry) => entry.bytes)
      const adoptedWork = Y.mergeUpdates(pendingUpdates)
      Y.applyUpdate(this.doc, adoptedWork, ADOPT)
      this.outboxes.splice(-1, 0, box)
    }
    this.onUnsentChanged()
    if (this.unsent && this.bound) {
      this.scheduleSend()
    }
  }

  // Rows are applied strictly in rev order; rows heard past a hole wait for it
  private applyRows(rows: Row[], opening?: Opening) {
    const contiguousRows = this.takeRun(rows)
    if (!contiguousRows.length && !opening) return

    const checkpointParts = opening?.checkpoint ? [opening.checkpoint] : []
    // An empty row is a quarantined rev: it holds its place in the order and applies nothing
    const rowParts = contiguousRows.filter((row) => row.bytes.length).map((row) => row.bytes)
    const parts = [...checkpointParts, ...rowParts]
    let bytes: Uint8Array | null = null
    try {
      if (parts.length) {
        bytes = Y.mergeUpdates(parts)
      }
      if (bytes) {
        Y.applyUpdate(this.doc, bytes, REMOTE)
      }
    } catch {
      // Yjs keeps what it applied, so this copy follows nothing more until the server judges the rows
      const suspectRev = contiguousRows.at(-1)?.rev ?? this.appliedThrough
      return this.markSuspect(suspectRev)
    }

    if (contiguousRows.length) {
      this.appliedThrough = contiguousRows[contiguousRows.length - 1].rev
    }
    for (const rev of this.waitingRows.keys()) {
      if (rev <= this.appliedThrough) {
        this.waitingRows.delete(rev)
      }
    }
    this.storeCopy(bytes)
    if (bytes) {
      this.notifyListeners()
    }
  }

  // The rows that continue from appliedThrough without a gap, taken out of `waitingRows`
  private takeRun(rows: Row[]): Row[] {
    const byRev = new Map(this.waitingRows)
    for (const row of rows) {
      byRev.set(row.rev, row)
    }

    const run: Row[] = []
    for (let rev = this.appliedThrough + 1; byRev.has(rev); rev++) {
      run.push(byRev.get(rev)!)
    }
    for (const row of run) {
      this.waitingRows.delete(row.rev)
    }
    return run
  }

  private storeCopy(bytes: Uint8Array | null) {
    if (!this.device) return

    const copy = {
      lineage: this.lineage,
      rev: this.appliedThrough,
      canWrite: this.writable,
      epoch: this.epoch,
    }
    void this.device.store.commit(this.device.doc, copy, bytes).catch(() => {})
  }

  private markSuspect(rev: number) {
    this.judging = { rev, seen: null }
    this.setPaused('suspect')
    void this.reportSuspect()
  }

  private async reportSuspect() {
    const judging = this.judging
    if (!judging || this.closed) return

    let reply: Reply
    try {
      const answer = await this.options.endpoints.suspect(judging.rev)
      reply = readReply(answer)
    } catch {
      this.onUnreachable()
      return this.reportSuspectAfter(backoffMs())
    }

    if (reply.status === 202 && typeof reply.judged === 'number') {
      judging.seen = reply.judged
    } else if (reply.status === 423) {
      if (reply.reason === 'suspect') {
        this.setHeld(this.held ?? 'change')
      }
      this.reportSuspectAfter(reply.retry_ms ?? 1000)
    } else if (reply.status === 200 && reply.verdict) {
      await this.applyVerdict(reply.verdict)
    } else {
      // Only a verdict counts against this browser; a failing server or a lapsed sign-in is asked again
      const blocked = this.classifyRefusal(reply, 'lost_read')
      if (!blocked || isRecoverable(blocked)) {
        this.reportSuspectAfter(backoffMs())
      }
    }
  }

  private reportSuspectAfter(ms: number) {
    if (this.closed) return

    const reportAgain = () => {
      this.reportTimer = null
      void this.reportSuspect()
    }
    this.reportTimer = setTimeout(reportAgain, ms)
  }

  private async checkVerdict(header: PullHeader) {
    const judging = this.judging!
    const judgedCount = header.judged ?? 0
    if (judging.seen === null || judgedCount <= judging.seen) return

    judging.seen = header.judged!
    await this.applyVerdict(header.verdict ?? 'unjudged')
  }

  // A held document waits for an admin. Anything but a quarantine means this browser failed on rows the server takes
  private async applyVerdict(verdict: string) {
    if (verdict === 'held') return

    if (verdict !== 'quarantined' && recordStrike(this.lineage) >= MAX_STRIKES) {
      return this.stopForGood('browser')
    }

    // Unsent work kept nowhere else is sent from this copy before it is rebuilt
    this.judging = null
    this.setPaused(null)
    this.markNeedsRebuild()
    if (this.unsent) {
      this.scheduleSend()
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) {
      this.lastRemoteAt = Date.now()
    }
    const fromElsewhere = origin === REMOTE || origin === ADOPT
    if (fromElsewhere || this.closed) return

    // The editor turns read-only a moment after the verdict, so typing can still arrive
    if (this.stopReason) {
      this.recoverLateTyping(update, this.stopReason)
      return
    }

    if (!this.writable) return

    const entry = this.ownOutbox.add(update)
    if (this.device) {
      const session = this.ownSession()
      const stored = this.ownOutbox.toStoredEntries(this.device.doc, [entry])
      void this.device.store.capture(session, stored).catch(() => this.dropDeviceStore())
    }
    this.onUnsentChanged()
    if (this.bound) {
      this.scheduleSend()
    } else {
      this.requestPersistentStorage()
    }
  }

  private recoverLateTyping(update: Uint8Array, reason: string) {
    if (!this.device) return

    const entry = this.ownOutbox.createEntry(update)
    const stored = this.ownOutbox.toStoredEntries(this.device.doc, [entry])
    void this.device.store
      .recover(this.device.doc, this.ownOutbox.sid, reason, stored)
      .catch(() => {})
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.sendNow()
    }
  }

  // A hidden or departing page may never run its send timer, its retry, or hear back from a save on its way
  private sendNow = () => {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer)
    }
    this.sendTimer = null
    if (this.inFlight) {
      const keepalivePush = this.preparePush(true)
      if (keepalivePush && !keepalivePush.pieces) {
        void this.options.endpoints.push(keepalivePush.body, { keepalive: true }).catch(() => {})
      }
      return
    }

    this.endRetry?.()
    void this.send({ keepalive: true })
  }

  private scheduleSend() {
    const now = Date.now()
    if (!this.sendTimer) {
      this.firstUnsentAt = now
    } else {
      clearTimeout(this.sendTimer)
    }

    // By default an edit goes out at once; edits made while a push is in flight go out together after it
    const sendDelay = this.options.sendDelayMs ?? 0
    const sendBy = this.firstUnsentAt + (this.options.sendMaxDelayMs ?? 0)
    const delay = Math.min(sendDelay, sendBy - now)
    const sendQueued = () => {
      this.sendTimer = null
      void this.send()
    }
    this.sendTimer = setTimeout(sendQueued, Math.max(0, delay))
  }

  private preparePush(keepalive?: boolean) {
    const box = this.outboxes.find((other) => other.pending.length) ?? this.ownOutbox
    const cannotSend = this.closed || !this.bound || this.judging || this.saveState === 'failed'
    if (!box.pending.length || cannotSend) return null

    const maxBytes = keepalive ? MAX_KEEPALIVE_BYTES : MAX_PUSH_BYTES
    const entries = box.nextBatch(maxBytes)
    const header = {
      proto: 1,
      lineage: this.lineage,
      principal: this.options.principal,
      schema: this.options.schema,
      sid: box.sid,
      from: entries[0].seq,
      to: entries[entries.length - 1].seq,
      cid: box.cid,
      seen_rev: this.appliedThrough,
      shas: entries.map((entry) => entry.sha),
      // The tab is hiding or closing, so the server may compact now
      final: !!keepalive,
    }
    const batchUpdates = entries.map((entry) => entry.bytes)
    const update = Y.mergeUpdates(batchUpdates)
    if (update.byteLength <= PIECE_BYTES) {
      const body = encodePush(header, update)
      return { box, header, body }
    }

    // Staged pieces take several requests, which a departing page can't count on
    this.staging = stageFor(this.staging, header)
    const staged = {
      ...header,
      final: false,
      stage_id: this.staging.id,
    }
    const pieces = {
      stage: this.staging.id,
      update,
    }
    const body = encodePush(staged, new Uint8Array())
    return {
      box,
      header: staged,
      body,
      pieces,
    }
  }

  private send(request: { keepalive?: boolean } = {}): Promise<void> {
    if (this.inFlight || this.retrying) {
      return this.inFlight ?? this.retrying!
    }

    const prepared = this.preparePush(request.keepalive)
    if (!prepared) return Promise.resolve()

    const { box, header, body, pieces } = prepared
    const { endpoints } = this.options
    const push = async () => {
      if (pieces) {
        const refused = await putPieces(endpoints, pieces.stage, header, pieces.update)
        if (refused) return refused
      }

      const pushOptions = pieces ? {} : request
      const answer = await endpoints.push(body, pushOptions)
      return readReply(answer)
    }
    const pushFailed = () => {
      this.onUnreachable()
      this.retryAfter(backoffMs())
    }
    const pushDone = () => {
      this.inFlight = null
      this.notifyListeners()
    }
    this.inFlight = Promise.resolve()
      .then(push)
      .then((reply) => this.settlePush(reply, box, header.to), pushFailed)
      .finally(pushDone)
    this.notifyListeners()
    return this.inFlight
  }

  private async settlePush(reply: Reply, box: Outbox, lastSeq: number) {
    if (reply.status !== 423) {
      this.setPaused(null)
    }
    if (reply.status === 200) {
      this.onCommitted(reply, box, lastSeq)
      return
    }

    if (reply.status === 409 && reply.collab === 'seq' && typeof reply.acked === 'number') {
      // The server lost seqs it already acknowledged, so resending can't restore them
      if (reply.acked < box.acked) {
        return this.stopForGood('seq')
      }

      this.acknowledge(box, reply.acked)
      if (box.hasGap) {
        return this.stopForGood('seq')
      }

      return this.retryAfter(0)
    }

    // Pieces the server dropped or never got are staged again; a stage it refused is replaced
    const stageFailed = reply.collab === 'stage_conflict' || reply.collab === 'stage_incomplete'
    if (reply.status === 409 && stageFailed) {
      if (reply.collab === 'stage_conflict') {
        this.staging = null
      }
      return this.retryAfter(backoffMs())
    }

    // A change that adds content to a full document is never taken, so it waits in a recovery copy
    if (reply.status === 423 && reply.collab === 'doc_full') {
      await this.stopForGood('document_full')
      return this.markNeedsRebuild()
    }

    if (reply.status === 423) {
      if (reply.reason === 'suspect') {
        this.setHeld(this.held ?? 'change')
      }
      this.setPaused(reply.reason ?? reply.collab ?? 'busy')
      return this.retryAfter(reply.retry_ms ?? 1000)
    }

    const blocked = this.classifyRefusal(reply, 'lost_edit')
    if (blocked && isRecoverable(blocked)) {
      return this.retryAfter(backoffMs())
    }

    if (blocked) return

    if (!reply.collab) {
      // Only a proxy refuses a body without a reason; the change stays here until uploads get through
      if (reply.status === 413) {
        this.setPaused('upload_refused')
      }
      return this.retryAfter(backoffMs())
    }

    await this.stopForGood(reply.collab)
    // The server quarantined a change of this session, which this copy still holds
    if (reply.collab === 'client_closed') {
      this.markNeedsRebuild()
    }
  }

  private onCommitted(reply: Reply, box: Outbox, lastSeq: number) {
    this.onServerHeard()
    const ackedThrough = reply.dup ? (reply.acked ?? lastSeq) : lastSeq
    this.acknowledge(box, ackedThrough)
    if (!reply.dup && typeof reply.rev === 'number') {
      this.realtime?.pushed(reply.rev)
    }

    const head = reply.head ?? 0
    const rowsAhead = head > this.appliedThrough
    // Live, the rows come over the socket; one still missing in a second is pulled
    if (rowsAhead && this.realtime?.live) {
      this.realtime.pullHoleLater(() => this.appliedThrough < head)
    } else if (rowsAhead) {
      void this.pull()
    }
    if (this.unsent) {
      this.scheduleSend()
    }
  }

  // A refusal about who is asking, or a lost right once the signed-in person is confirmed unchanged
  private classifyRefusal(reply: Reply, lostAccess: 'lost_edit' | 'lost_read'): Blocked | null {
    let blocked: Blocked | null = null
    if (reply.status === 401 && (reply.collab === 'signed_out' || reply.collab === 'locked')) {
      blocked = reply.collab
    } else if (isStaleSession(reply)) {
      blocked = 'stale_session'
    } else if (reply.status === 409 && reply.collab === 'principal_changed') {
      blocked = 'other_user'
    } else if (reply.status === 403 || reply.status === 404) {
      blocked = this.confirmLostAccess(lostAccess)
    }
    if (blocked) {
      this.block(blocked)
    }
    return blocked
  }

  private confirmLostAccess(lostAccess: Blocked): Blocked {
    const signedIn = this.options.signedIn()
    if (signedIn === 'Guest') return 'signed_out'

    if (signedIn !== this.options.principal) return 'other_user'

    return lostAccess
  }

  // A lost right keeps the unsent work only as a recovery copy; another person's or a stale sign-in leaves it for a later tab
  private block(reason: Blocked) {
    const sameReason = this.blocked === reason
    const outranked = !!this.blocked && !replaces(reason, this.blocked)
    if (sameReason || outranked) return

    if (!isRecoverable(reason)) {
      this.writable = false
      if (this.unsent) {
        this.failed = true
      }
      if (reason === 'lost_edit' || reason === 'lost_read') {
        void this.moveToRecovery('lost_access')
      }
    }
    this.blocked = reason
    this.notifyListeners()
  }

  // The work this tab holds can never be committed: keep it as a recovery copy and stop
  private async stopForGood(reason: string) {
    this.writable = false
    this.failed = true
    const recovered = this.moveToRecovery(reason)
    this.notifyListeners()
    await recovered
  }

  private async moveToRecovery(reason: string) {
    if (this.stopReason) return

    this.stopReason = reason
    if (!this.device) return

    const { store, doc: docName } = this.device
    for (const box of this.outboxes) {
      const stored = box.toStoredEntries(docName)
      await store.recover(docName, box.sid, reason, stored).catch(() => {})
    }
  }

  // Without a device store nothing typed offline would survive the tab, so editing stops until the server answers
  private onUnreachable() {
    this.unheard = true
    if (this.device) {
      if (this.unsent) {
        this.requestPersistentStorage()
      }
    } else if (!this.blocked) {
      this.block('offline')
    }
  }

  private markNeedsRebuild() {
    if (this.needsRebuild) return

    this.needsRebuild = true
    this.notifyListeners()
  }

  private dropDeviceStore() {
    if (!this.device) return

    this.device = null
    this.notifyListeners()
  }

  private requestPersistentStorage() {
    if (this.persisted || !this.device) return

    this.persisted = true
    void globalThis.navigator?.storage?.persist?.().catch(() => {})
  }

  private updateLimits(limits: Limits) {
    const wasAtLimit = this.atLimit
    this.limits = limits
    if (this.atLimit !== wasAtLimit) {
      this.notifyListeners()
    }
  }

  private setPaused(reason: string | null) {
    if (this.paused === reason) return

    this.paused = reason
    this.notifyListeners()
  }

  // An editor older than the document's rows may drop what it can't show; nothing it does from now on is sent.
  // Work typed before still goes out, as the server takes older schemas
  private follow(schema = 0) {
    if (this.newerSchema) return false

    if (schema <= this.options.schema) return true

    this.newerSchema = true
    this.writable = false
    this.notifyListeners()
    return false
  }

  // A held document's pushes wait minutes between tries, so its release sends at once
  private setHeld(held: string | null) {
    if (this.held === held) return

    const released = !held
    this.held = held
    this.notifyListeners()
    if (released && this.retrying) {
      this.endRetry?.()
      void this.send()
    }
  }

  // Work held while the server was out of reach goes out on the first answer, not after the retry wait
  private onServerHeard() {
    const wasUnheard = this.unheard
    this.unheard = false
    if (this.blocked && !isRecoverable(this.blocked)) return

    const wasBlocked = this.blocked !== null
    if (wasBlocked) {
      this.blocked = null
      this.notifyListeners()
    }
    if ((wasBlocked || wasUnheard) && this.retrying) {
      this.endRetry?.()
      void this.send()
    }
  }

  private acknowledge(box: Outbox, through: number) {
    const committed = box.acknowledge(through)
    if (!committed) return

    if (this.device) {
      void this.device.store
        .acknowledge(this.device.doc, box.sid, box.acked, committed, this.lineage, this.epoch)
        .catch(() => {})
      if (box.adopted && !box.pending.length) {
        void this.device.store.release(this.device.doc, box.sid).catch(() => {})
        box.release()
        this.outboxes = this.outboxes.filter((other) => other !== box)
      }
    }
    this.onUnsentChanged()
  }

  private onUnsentChanged() {
    if (!this.unsent) {
      this.unsentSince = 0
    } else if (!this.unsentSince) {
      this.unsentSince = Date.now()
    }
    this.notifyListeners()
  }

  private ownSession(): StoredSession {
    return {
      doc: this.device!.doc,
      sid: this.ownOutbox.sid,
      lineage: this.lineage,
      cid: this.ownOutbox.cid,
      bound: this.bound,
    }
  }

  private lockName(sid: string) {
    return `suite-collab:${this.device?.doc}:${sid}`
  }

  private retryAfter(ms: number) {
    if (this.closed) return

    this.endRetry?.()
    const waitForRetry = (resolve: () => void) => {
      this.endRetry = () => {
        if (this.retryTimer) {
          clearTimeout(this.retryTimer)
        }
        this.retryTimer = this.retrying = this.endRetry = null
        resolve()
      }

      const retryNow = () => {
        this.endRetry?.()
        void this.send()
      }
      this.retryTimer = setTimeout(retryNow, ms)
    }
    this.retrying = new Promise<void>(waitForRetry)
  }

  private clearTimers() {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer)
    }
    if (this.reportTimer) {
      clearTimeout(this.reportTimer)
    }
    this.sendTimer = this.reportTimer = null
    this.endRetry?.()
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

// Losing edit access can still turn out to be losing read access or a switched account
function replaces(next: Blocked, current: Blocked) {
  return (
    isRecoverable(current) ||
    (current === 'lost_edit' && (next === 'lost_read' || next === 'other_user'))
  )
}

const lostReason = (verdict: string) => (verdict === 'clash' ? 'id_clash' : verdict)

function recordStrike(lineage: string) {
  const now = Date.now()
  const strikeTimes = strikes.get(lineage) ?? []
  const recent = strikeTimes.filter((at) => now - at < STRIKE_WINDOW_MS)
  recent.push(now)
  strikes.set(lineage, recent)
  return recent.length
}

const backoffMs = () => 1000 + Math.random() * 29_000
