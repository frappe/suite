import * as Y from 'yjs'

import { classifyRefusal, type AccessRoom } from './access'
import { readReply, type Reply } from './answers'
import { backoffMs } from './backoff'
import type { Copier } from './copier'
import { encodePush, type PushHeader } from './frames'
import type { Live } from './live'
import {
  KEEPALIVE_QUOTA,
  MAX_HEADER_BYTES,
  MAX_KEEPALIVE_BYTES,
  MAX_PUSH_BYTES,
  type Entry,
  type Outbox,
} from './outbox'
import { PIECE_BYTES, putPieces, stageFor, type Staging } from './pieces'
import { isRecoverable, type Held, type SaveState } from './types'
import type { SuspectReport } from './verdict'

/** What sending this tab's work reads and changes on the room. */
export interface SenderRoom extends AccessRoom {
  readonly lineage: string
  readonly bound: boolean
  readonly closed: boolean
  readonly held: Held | null
  readonly appliedThrough: number
  readonly saveState: SaveState
  readonly ownOutbox: Outbox
  readonly outboxes: readonly Outbox[]
  readonly realtime: Pick<Live, 'live' | 'pushed' | 'pullHoleLater'> | null
  readonly suspect: Pick<SuspectReport, 'isJudging'>
  readonly copier: Pick<Copier, 'committed'>
  pull(): Promise<void>
  acknowledge(box: Outbox, through: number): void
  setPaused(reason: string | null): void
  setHeld(held: Held | null): void
  markNeedsRebuild(): void
  stopForGood(reason: string): Promise<void>
  restoreLanded(rev: number, bytes: Uint8Array): void
  restoreLost(): Promise<void>
  onServerHeard(): void
  onUnreachable(): void
}

// The gap between pushes until the server names its own
const DEFAULT_PACE_MS = 500
const MAX_PACE_MS = 10_000
// The server is busy or holds the document; the push is asked again
const LOCKED = 423
const BUSY_RETRY_MS = 1000

// The seqs of one session a push carries, through `to`
type PushRange = { box: Outbox; to: number }
// A keepalive push ready to send, with the seqs it carries
type KeepalivePush = { header: { from: number; to: number }; body: Uint8Array<ArrayBuffer> }
// A push ready to send; a large one goes as staged pieces first
interface PreparedPush {
  box: Outbox
  header: PushHeader
  body: Uint8Array<ArrayBuffer>
  pieces?: { stage: string; update: Uint8Array }
}

// A server pace that is missing or not a number falls back to the default; one out of range is held to it
function paceWithinRange(paceMs: unknown) {
  if (typeof paceMs !== 'number' || !Number.isFinite(paceMs)) {
    return DEFAULT_PACE_MS
  }

  return Math.min(Math.max(paceMs, 0), MAX_PACE_MS)
}

// The restore a push carries, read before its ack takes the entries away
function restoreIn(box: Outbox, header: PushHeader) {
  const landed = box.pending.filter((entry) => entry.restore && entry.seq <= header.to)
  if (!header.restore || !landed.length) {
    return null
  }

  return Y.mergeUpdates(landed.map((entry) => entry.bytes))
}

// Pushes the room's unsent work one push at a time, at the server's pace, and settles each answer
export class Sender {
  inFlight: Promise<void> | null = null
  retrying: Promise<void> | null = null
  private inFlightRange: PushRange | null = null
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private paceMs = DEFAULT_PACE_MS
  private lastPushStartedAt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private endRetry: (() => void) | null = null
  private staging: Staging | null = null

  constructor(private readonly room: SenderRoom) {}

  // A hidden or departing page may never run its send timer, its retry, or hear back from a save on its way
  sendNow = () => {
    this.cancelQueuedSend()
    // The push on its way may have landed unanswered, which only what follows it continues,
    // or never reached the server, which only all of it covers
    if (this.inFlight) {
      this.sendKeepalivePair()
      return
    }

    this.endRetry?.()
    void this.send({ keepalive: true })
  }

  // The first edit after a quiet spell goes out at once; later ones wait out the server's pace and go together
  scheduleSend() {
    if (this.sendTimer) return

    const paceEndsAt = this.lastPushStartedAt + this.paceMs
    const wait = Math.max(0, paceEndsAt - Date.now())
    const sendQueued = () => {
      this.sendTimer = null
      void this.send()
    }
    this.sendTimer = setTimeout(sendQueued, wait)
  }

  // Typing already waiting goes out by the new pace
  setPace(paceMs: unknown) {
    this.paceMs = paceWithinRange(paceMs)
    if (this.sendTimer) {
      this.cancelQueuedSend()
      this.scheduleSend()
    }
  }

  // A retry waiting out its delay goes now
  retryNow() {
    if (!this.retrying) return

    this.endRetry?.()
    void this.send()
  }

  clearTimers() {
    this.cancelQueuedSend()
    this.endRetry?.()
  }

  send(request: { keepalive?: boolean } = {}): Promise<void> {
    if (this.inFlight || this.retrying) {
      return this.inFlight ?? this.retrying!
    }

    const prepared = this.preparePush(request.keepalive)
    if (!prepared) {
      return Promise.resolve()
    }

    // What was queued goes in this push
    this.cancelQueuedSend()
    this.lastPushStartedAt = Date.now()

    const { box, header } = prepared
    this.inFlightRange = { box, to: header.to }
    this.inFlight = Promise.resolve()
      .then(() => this.push(prepared, request))
      .then(
        (reply) => this.settlePush(reply, box, header),
        () => this.onPushFailed(),
      )
      .finally(() => this.endPush())
    this.room.notifyListeners()
    return this.inFlight
  }

  private async push({ header, body, pieces }: PreparedPush, request: { keepalive?: boolean }) {
    const { endpoints } = this.room.options
    if (!pieces) {
      return readReply(await endpoints.push(body, request))
    }

    const { lineage, principal, sid, from, to } = header
    const place = { lineage, principal, sid, from, to }
    const refused = await putPieces(endpoints, pieces.stage, place, pieces.update)
    if (refused) {
      return refused
    }

    return readReply(await endpoints.push(body, {}))
  }

  private onPushFailed() {
    this.room.onUnreachable()
    this.retryAfter(backoffMs())
  }

  private endPush() {
    this.inFlight = null
    this.inFlightRange = null
    this.room.notifyListeners()
  }

  // Both are in flight at once, so they share the browser's keepalive quota
  private sendKeepalivePair() {
    const pending = this.inFlightRange?.box.pending ?? []
    const lastUnsent = pending[pending.length - 1]?.seq
    const overlapAlone = this.keepalivePush(null, KEEPALIVE_QUOTA)
    // The server stores only what it lacks, so an overlap that carries all the unsent work goes alone
    if (overlapAlone && overlapAlone.header.to === lastUnsent) {
      this.sendKeepalive(overlapAlone.body)
      return
    }

    const tail = this.keepalivePush(this.inFlightRange, KEEPALIVE_QUOTA / 2)
    const overlap = this.keepalivePush(null, KEEPALIVE_QUOTA - (tail?.body.byteLength ?? 0))
    if (tail && overlap) {
      this.sendKeepalive(tail.body)
      this.sendKeepalive(overlap.body)
      return
    }

    // When only one fits, the overlap holds the most
    const alone = overlapAlone ?? this.keepalivePush(this.inFlightRange, KEEPALIVE_QUOTA)
    if (alone) {
      this.sendKeepalive(alone.body)
    }
  }

  private sendKeepalive(body: Uint8Array<ArrayBuffer>) {
    void this.room.options.endpoints.push(body, { keepalive: true }).catch(() => {})
  }

  // Null when there is nothing to send or not even one entry fits in `quota`
  private keepalivePush(
    after: PushRange | null,
    quota: number,
    maxBytes = quota - MAX_HEADER_BYTES,
  ): KeepalivePush | null {
    const prepared = this.preparePush(true, after, maxBytes)
    if (!prepared || prepared.pieces) {
      return null
    }

    const overshoot = prepared.body.byteLength - quota
    if (overshoot <= 0) {
      return prepared
    }

    if (prepared.header.from === prepared.header.to) {
      return null
    }

    // The header can outgrow its allowance, so fewer entries may fit
    return this.keepalivePush(after, quota, maxBytes - overshoot)
  }

  private cancelQueuedSend() {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer)
    }
    this.sendTimer = null
  }

  private preparePush(
    keepalive?: boolean,
    after: PushRange | null = null,
    maxBytes = keepalive ? MAX_KEEPALIVE_BYTES : MAX_PUSH_BYTES,
  ): PreparedPush | null {
    const batch = this.nextBatch(after, maxBytes)
    if (!batch) {
      return null
    }

    const header = this.pushHeader(batch.box, batch.entries, !!keepalive)
    const update = Y.mergeUpdates(batch.entries.map((entry) => entry.bytes))
    if (update.byteLength <= PIECE_BYTES) {
      return { box: batch.box, header, body: encodePush(header, update) }
    }

    return this.stagedPush(batch.box, header, update)
  }

  // The unsent entries that go next, from the first session holding any; null when none can go now
  private nextBatch(after: PushRange | null, maxBytes: number) {
    const room = this.room
    const box = after?.box ?? room.outboxes.find((other) => other.pending.length) ?? room.ownOutbox
    const cannotSend =
      room.closed || !room.bound || room.suspect.isJudging || room.saveState === 'failed'
    if (!box.pending.length || cannotSend) {
      return null
    }

    const entries = box.nextBatch(maxBytes, after?.to)
    if (!entries.length) {
      return null
    }

    return { box, entries }
  }

  private pushHeader(box: Outbox, entries: Entry[], isFinal: boolean): PushHeader {
    const room = this.room
    const header: PushHeader = {
      proto: 1,
      lineage: room.lineage,
      principal: room.options.principal,
      schema: room.options.adapter.features.schema,
      sid: box.sid,
      from: entries[0].seq,
      to: entries[entries.length - 1].seq,
      cid: box.cid,
      seen_rev: Math.min(...entries.map((entry) => entry.seenRev)),
      shas: entries.map((entry) => entry.sha),
      final: isFinal,
    }
    if (entries[0].restore) {
      header.restore = entries[0].restore
    }

    return header
  }

  // Staged pieces take several requests, which a departing page can't count on
  private stagedPush(box: Outbox, header: PushHeader, update: Uint8Array): PreparedPush {
    this.staging = stageFor(this.staging, header)
    const staged: PushHeader = { ...header, final: false, stage_id: this.staging.id }
    const pieces = { stage: this.staging.id, update }
    return { box, header: staged, body: encodePush(staged, new Uint8Array()), pieces }
  }

  private async settlePush(reply: Reply, box: Outbox, header: PushHeader) {
    if (reply.pace_ms !== undefined) {
      this.setPace(reply.pace_ms)
    }

    if (reply.status !== LOCKED) {
      this.room.setPaused(null)
    }

    if (reply.status === 200) {
      return this.onCommitted(reply, box, header)
    }

    if (reply.status === 409 && reply.collab === 'seq' && typeof reply.acked === 'number') {
      return this.onSeqConflict(box, reply.acked)
    }

    // Pieces the server dropped or never got are staged again; a stage it refused is replaced
    const stageFailed = reply.collab === 'stage_conflict' || reply.collab === 'stage_incomplete'
    if (reply.status === 409 && stageFailed) {
      return this.restage(reply.collab === 'stage_conflict')
    }

    if (reply.status === LOCKED) {
      return this.onBusy(reply)
    }

    return this.onRefused(reply)
  }

  private onSeqConflict(box: Outbox, acked: number) {
    // The server lost seqs it already acknowledged, so resending can't restore them
    if (acked < box.acked) {
      return this.room.stopForGood('seq')
    }

    this.room.acknowledge(box, acked)
    if (box.hasGap) {
      return this.room.stopForGood('seq')
    }

    return this.retryAfter(0)
  }

  private restage(isRefused: boolean) {
    if (isRefused) {
      this.staging = null
    }

    return this.retryAfter(backoffMs())
  }

  private async onBusy(reply: Reply) {
    const room = this.room
    // A change that adds content to a full document is never taken, so it waits in a recovery copy
    if (reply.collab === 'doc_full') {
      await room.stopForGood('document_full')
      return room.markNeedsRebuild()
    }

    if (reply.reason === 'suspect') {
      room.setHeld(room.held ?? 'change')
    }

    room.setPaused(reply.reason ?? reply.collab ?? 'busy')
    return this.retryAfter(reply.retry_ms ?? BUSY_RETRY_MS)
  }

  private async onRefused(reply: Reply) {
    const room = this.room
    const blocked = classifyRefusal(room, reply, 'lost_edit')
    if (blocked && isRecoverable(blocked)) {
      return this.retryAfter(backoffMs())
    }

    if (blocked) {
      return
    }

    if (!reply.collab) {
      // Only a proxy refuses a body without a reason; the change stays here until uploads get through
      if (reply.status === 413) {
        room.setPaused('upload_refused')
      }
      return this.retryAfter(backoffMs())
    }

    if (reply.collab === 'restore_lost') {
      return room.restoreLost()
    }

    await room.stopForGood(reply.collab)
    // The server quarantined a change of this session, or holds a restore this copy predates
    if (reply.collab === 'client_closed' || reply.collab === 'restored') {
      room.markNeedsRebuild()
    }
  }

  private onCommitted(reply: Reply, box: Outbox, header: PushHeader) {
    const room = this.room
    room.onServerHeard()
    this.acknowledge(reply, box, header)
    if (!reply.dup && typeof reply.rev === 'number') {
      room.realtime?.pushed(reply.rev)
    }

    const head = reply.head ?? 0
    // A repeat answer doesn't name the rev the work went in at, which the head covers
    let committedRev = head
    if (!reply.dup && typeof reply.rev === 'number') {
      committedRev = reply.rev
    }

    room.copier.committed(committedRev, reply.copy)
    const rowsAhead = head > room.appliedThrough
    // Live, the rows come over the socket; one still missing in a second is pulled
    if (rowsAhead && room.realtime?.live) {
      room.realtime.pullHoleLater(() => room.appliedThrough < head)
    } else if (rowsAhead) {
      void room.pull()
    }
    if (room.unsent) {
      this.scheduleSend()
    }
  }

  // A restore's entries leave the outbox with the ack, so they are read first
  private acknowledge(reply: Reply, box: Outbox, header: PushHeader) {
    const restore = restoreIn(box, header)
    let ackedThrough = header.to
    if (reply.dup) {
      ackedThrough = reply.acked ?? header.to
    }

    this.room.acknowledge(box, ackedThrough)
    // The server answers a repeated restore with the rev it first landed at
    if (restore && typeof reply.rev === 'number') {
      this.room.restoreLanded(reply.rev, restore)
    }
  }

  private retryAfter(delayMs: number) {
    if (this.room.closed) return

    this.endRetry?.()
    const waitForRetry = (resolve: () => void) => {
      this.endRetry = () => {
        if (this.retryTimer) {
          clearTimeout(this.retryTimer)
        }
        this.retryTimer = null
        this.retrying = null
        this.endRetry = null
        resolve()
      }

      this.retryTimer = setTimeout(() => this.retryNow(), delayMs)
    }
    this.retrying = new Promise<void>(waitForRetry)
  }
}
