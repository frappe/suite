import * as yjs from 'yjs'

import { classifyRefusal, isDisabled, type AccessRoom } from './access'
import { HTTP_OK, readReply } from './answers'
import type { Device } from './device'
import type { RestoreFence } from './fence'
import { decodeFrame, parseHeld, type Limits, type PullHeader, type Row } from './frames'
import type { Live } from './live'
import type { Opening } from './opening'
import { APPLIED_UPDATE, REMOTE } from './origins'
import type { Answer, Held } from './types'
import type { SuspectReport } from './verdict'

/** What taking the server's rows reads and changes on the room. */
export interface PullerRoom extends AccessRoom {
  readonly doc: yjs.Doc
  readonly device: Device | null
  readonly lineage: string
  readonly epoch: number
  readonly bound: boolean
  readonly closed: boolean
  readonly needsRebuild: boolean
  readonly newerSchema: boolean
  readonly readBlocked: boolean
  appliedThrough: number
  readonly realtime: Pick<Live, 'pullHoleLater' | 'setRoomKeys'> | null
  readonly suspect: Pick<SuspectReport, 'isJudging' | 'mark' | 'check'>
  pull(): Promise<void>
  follow(schema?: number): boolean
  setHeld(held: Held | null): void
  readonly fence: Pick<RestoreFence, 'follow'>
  followRestore(rev: unknown): boolean
  updateLimits(limits: Limits): void
  markNeedsRebuild(): void
  stopForGood(reason: string): Promise<void>
  onServerHeard(): void
  onUnreachable(): void
}

// Rows heard ahead of a missing one wait for it, up to this many
const WAITING_MAX = 256

// Takes the server's rows into the room's doc, pulled or heard over the socket, strictly in rev order
export class Puller {
  private pulling: Promise<void> | null = null
  private readonly waitingRows = new Map<number, Row>()

  constructor(private readonly room: PullerRoom) {}

  pullNow(): Promise<void> {
    if (this.room.closed) {
      return Promise.resolve()
    }

    this.pulling ??= this.room.options.endpoints
      .pull(this.room.appliedThrough, this.room.epoch)
      .then((answer) => this.applyPull(answer))
      .catch(() => this.room.onUnreachable())
      .finally(() => {
        this.pulling = null
      })
    return this.pulling
  }

  // A row from the realtime service; one written by a newer editor is pulled, so the schema gate sees it
  heardRows = (rows: Row[], schema = 0) => {
    const room = this.room
    const following = !room.needsRebuild && !room.suspect.isJudging && !room.newerSchema
    if (room.closed || !room.bound || !following || room.readBlocked) return

    if (schema > room.options.adapter.schemaVersion) {
      void room.pull()
      return
    }

    for (const row of rows) {
      // A row dropped past the cap comes back with the hole pull
      if (row.rev > room.appliedThrough && this.waitingRows.size < WAITING_MAX) {
        this.waitingRows.set(row.rev, row)
      }
    }

    this.applyRows([])
    if (this.waitingRows.size) {
      room.realtime?.pullHoleLater(() => this.waitingRows.size > 0)
    }
  }

  private updateParts(rows: Row[], opening?: Opening) {
    // An empty row is a quarantined rev: it holds its place in the order and applies nothing
    const rowParts = rows.filter((row) => row.bytes.length).map((row) => row.bytes)
    if (!opening?.checkpoint) {
      return rowParts
    }

    return [opening.checkpoint, ...rowParts]
  }

  private applyParts(parts: Uint8Array[]) {
    if (!parts.length) {
      return null
    }

    const room = this.room
    const bytes = yjs.mergeUpdates(parts)
    room.doc.transact((transaction) => {
      transaction.meta.set(APPLIED_UPDATE, parts)
      yjs.applyUpdate(room.doc, bytes, REMOTE)
    }, REMOTE)
    return bytes
  }

  private markApplied(rows: Row[]) {
    const room = this.room
    if (rows.length) {
      room.appliedThrough = rows[rows.length - 1].rev
    }

    for (const rev of this.waitingRows.keys()) {
      if (rev <= room.appliedThrough) {
        this.waitingRows.delete(rev)
      }
    }
  }

  // Rows are applied strictly in rev order; rows heard past a hole wait for it
  applyRows(rows: Row[], opening?: Opening) {
    const room = this.room
    const contiguousRows = this.takeRun(rows)
    if (!contiguousRows.length && !opening) return

    let bytes: Uint8Array | null = null
    try {
      bytes = this.applyParts(this.updateParts(contiguousRows, opening))
    } catch {
      // Yjs keeps what it applied, so this copy follows nothing more until the server judges the rows
      const suspectRev = contiguousRows.at(-1)?.rev ?? room.appliedThrough
      return room.suspect.mark(suspectRev)
    }

    this.markApplied(contiguousRows)
    this.storeCopy(bytes)
    if (bytes) {
      room.notifyListeners()
    }
  }

  private takeRefusal(answer: Answer) {
    const room = this.room
    const reply = readReply(answer)
    if (isDisabled(reply)) {
      void room.stopForGood('disabled')
      return
    }

    classifyRefusal(room, reply, 'lost_read')
  }

  private applyPull(answer: Answer) {
    const room = this.room
    if (answer.status !== HTTP_OK) {
      return this.takeRefusal(answer)
    }

    const { header, rows } = decodeFrame<PullHeader>(answer.bytes)
    room.onServerHeard()
    if (header.rooms) {
      room.realtime?.setRoomKeys(header.rooms)
    }

    if (header.limits) {
      room.updateLimits(header.limits)
    }

    if (header.state === 'rebuild') {
      return room.markNeedsRebuild()
    }

    room.setHeld(parseHeld(header.held))
    room.fence.follow(header.restoring_ms)
    if (!room.followRestore(header.restore_rev)) return

    if (!room.follow(header.schema)) return

    if (room.suspect.isJudging) {
      return room.suspect.check(header)
    }

    this.applyRows(rows)
  }

  // The rows that continue from appliedThrough without a gap, taken out of `waitingRows`
  private takeRun(rows: Row[]): Row[] {
    const byRev = new Map(this.waitingRows)
    for (const row of rows) {
      byRev.set(row.rev, row)
    }

    const run: Row[] = []
    for (let rev = this.room.appliedThrough + 1; byRev.has(rev); rev++) {
      run.push(byRev.get(rev)!)
    }

    for (const row of run) {
      this.waitingRows.delete(row.rev)
    }

    return run
  }

  private storeCopy(bytes: Uint8Array | null) {
    const room = this.room
    if (!room.device) return

    const copy = {
      lineage: room.lineage,
      rev: room.appliedThrough,
      canWrite: room.writable,
      epoch: room.epoch,
    }
    void room.device.commit(copy, bytes)
  }
}
