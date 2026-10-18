import type { RoomKeys, Row } from './frames'
import { Hub, type HubMember } from './hub'
import { lineageOf, parseRow, type JoinAnswer } from './payloads'
import { Presence, type PresenceHooks } from './presence'
import type { LiveSocket, LiveState } from './types'

// A key stays in use this long past its epoch, for clocks a little behind the server's
const GRACE_S = 5
// Without an answer to a join this long, the room says live updates are unavailable
const JOIN_MS = 5000
// A push's own row should come back over the socket within this long
const OWN_ROW_MS = 2000
// After this many own rows missed in a row, the room polls instead
const MAX_MISSED_OWN_ROWS = 3
// A missing rev is pulled once it has been missing this long
const HOLE_MS = 1000
// A peer's caret can ask for a pull this often at most
const CARET_PULL_MS = 10_000
const HEARD_MAX = 256

export interface LiveHooks {
  // Rows heard over the socket, with the schema of the editor that wrote them
  heardRows(rows: Row[], schema?: number): void
  pull(): void
  changed(): void
  // This tab's applied_through, and whether it shows its caret
  appliedThrough(): number
  showsCaret(): boolean
  position(raw: unknown): object | null
  // A control message for this document, such as a restore beginning or ending
  controlHeard(heard: Record<string, unknown>): void
  // The socket is back, and notices sent while it was away are lost
  reconnected(): void
}

// One pending timer at most; setting it again replaces the one waiting
class TimerSlot {
  private timer: ReturnType<typeof setTimeout> | null = null

  get isSet() {
    return this.timer !== null
  }

  set(callback: () => void, ms: number) {
    this.clear()
    const run = () => {
      this.timer = null
      callback()
    }
    this.timer = setTimeout(run, ms)
  }

  clear() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

// Rows reach the room over the realtime socket as they commit. Anything missed is pulled after a jittered
// delay, so a realtime restart doesn't send every tab to the server at once
export class Live implements HubMember {
  state: LiveState = 'joining'
  readonly presence: Presence
  private readonly hub: Hub
  private closed = false

  // The room keys, and server seconds minus this browser's
  private keys: RoomKeys | null = null
  private clockOffset = 0

  // Whether the realtime service took this tab's join, and for how long the room still waits for it
  private joinAccepted = false
  private joinUntil = Date.now() + JOIN_MS
  private memberCount = 1

  // Own rows heard, and those still awaited
  private missedOwnRows = 0
  private readonly heardRevs = new Set<number>()
  private readonly awaitedRevs = new Map<number, ReturnType<typeof setTimeout>>()

  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly refreshTimer = new TimerSlot()
  private readonly repairTimer = new TimerSlot()
  private readonly holeTimer = new TimerSlot()
  private lastCaretPullAt = -Infinity

  constructor(
    private readonly socket: LiveSocket,
    private readonly lineage: string,
    private readonly hooks: LiveHooks,
  ) {
    const presenceHooks: PresenceHooks = {
      isOwnRoom: (room) => this.currentKeys().includes(room),
      appliedThrough: () => hooks.appliedThrough(),
      showsCaret: () => hooks.showsCaret(),
      position: hooks.position,
      peerAhead: (peerAppliedThrough) => this.onPeerAhead(peerAppliedThrough),
    }
    this.presence = new Presence(socket, presenceHooks)

    this.hub = Hub.forSocket(socket)
    this.hub.members.add(this)

    socket.on('suite_collab_row', this.onRowHeard)
    socket.on('suite_collab_ctl', this.onControl)
    window.addEventListener('online', this.wake)
    window.addEventListener('focus', this.wake)
    document.addEventListener('visibilitychange', this.onVisibilityChange)

    this.runAfter(JOIN_MS, () => this.updateState())
  }

  get live() {
    return this.state === 'live'
  }

  // The rooms an open or a pull named; a fresh pair is asked for early in the next epoch
  setRoomKeys(keys: RoomKeys) {
    if (this.closed) return

    this.clockOffset = keys.server_time - Date.now() / 1000
    if (this.keys?.keys.join() === keys.keys.join()) return

    this.keys = keys

    const nextEpochStart = (keys.epoch + 1) * keys.epoch_seconds
    const refreshAt = nextEpochStart + Math.random() * 0.8 * keys.epoch_seconds
    const pullIfVisible = () => {
      if (document.visibilityState === 'visible') {
        this.hooks.pull()
      }
    }
    this.refreshTimer.set(pullIfVisible, this.msUntilServerTime(refreshAt))

    // Each key leaves the set when its epoch ends
    const dropEndedKey = () => {
      this.hub.sendRoomSet()
      this.updateState()
    }
    for (const epochEnd of [nextEpochStart, nextEpochStart + keys.epoch_seconds]) {
      this.runAfter(this.msUntilServerTime(epochEnd + GRACE_S), dropEndedKey)
    }

    this.hub.sendRoomSet()
  }

  // The keys still in use now
  currentKeys(): string[] {
    if (!this.keys || this.closed) {
      return []
    }

    const now = Date.now() / 1000 + this.clockOffset
    const { epoch, epoch_seconds: epochSeconds, keys } = this.keys
    return keys.filter((_, epochOffset) => now < (epoch + epochOffset + 1) * epochSeconds + GRACE_S)
  }

  // A push of this tab's was committed as `rev`; its row should come back over the socket
  pushed(rev: number) {
    if (!this.joinAccepted || this.closed) return

    if (this.heardRevs.has(rev)) {
      this.ownRowHeard()
      return
    }

    const missed = () => {
      this.awaitedRevs.delete(rev)
      this.missedOwnRows++
      this.updateState()
    }
    const timer = setTimeout(missed, OWN_ROW_MS)
    this.awaitedRevs.set(rev, timer)
  }

  // Rows wait in order behind a missing rev; if it is still missing in a second it is pulled
  pullHoleLater(stillMissing: () => boolean) {
    if (this.holeTimer.isSet || this.closed) return

    const repairIfStillMissing = () => {
      if (stillMissing()) {
        this.repair()
      }
    }
    this.holeTimer.set(repairIfStillMissing, HOLE_MS)
  }

  // One pull, after a random share of a delay that grows with the room
  repair() {
    if (this.repairTimer.isSet || this.closed) return

    const spread = Math.min(30_000, 50 * this.memberCount)
    this.repairTimer.set(() => this.hooks.pull(), Math.random() * spread)
  }

  answered(answer: JoinAnswer | null, rooms: string[]) {
    const ownKeys = this.currentKeys()
    const inAllRooms = ownKeys.length > 0 && ownKeys.every((key) => rooms.includes(key))

    this.joinAccepted = !!answer && inAllRooms
    if (answer && inAllRooms) {
      this.memberCount = 1 + answer.count
    }

    if (answer) {
      this.presence.answered(answer, rooms)
    } else {
      this.presence.clear()
    }
    this.updateState()
  }

  connected() {
    this.joinAccepted = false
    this.joinUntil = Date.now() + JOIN_MS
    this.runAfter(JOIN_MS, () => this.updateState())
    this.repair()
    this.updateState()
    this.hooks.reconnected()
  }

  dropped() {
    this.joinAccepted = false
    this.presence.clear()
    this.joinUntil = Date.now() + JOIN_MS
    this.runAfter(JOIN_MS, () => this.updateState())
    this.updateState()
  }

  close() {
    if (this.closed) return

    this.closed = true

    this.socket.off('suite_collab_row', this.onRowHeard)
    this.socket.off('suite_collab_ctl', this.onControl)
    window.removeEventListener('online', this.wake)
    window.removeEventListener('focus', this.wake)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)

    for (const timer of [...this.timers, ...this.awaitedRevs.values()]) {
      clearTimeout(timer)
    }
    for (const slot of [this.refreshTimer, this.repairTimer, this.holeTimer]) {
      slot.clear()
    }

    this.presence.close()
    this.hub.leave(this)
  }

  private onRowHeard = (heard: unknown) => {
    const row = parseRow(heard, this.lineage)
    if (this.closed || !row) return

    const rev = row.rev

    this.heardRevs.add(rev)
    if (this.heardRevs.size > HEARD_MAX) {
      this.heardRevs.delete(Math.min(...this.heardRevs))
    }

    const timer = this.awaitedRevs.get(rev)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.awaitedRevs.delete(rev)
      this.ownRowHeard()
    }

    // A row without its bytes, or with bytes that aren't base64, is pulled instead
    if (row.content) {
      this.hooks.heardRows([{ rev, bytes: row.content.bytes }], row.content.schema)
    } else {
      this.repair()
    }
  }

  // A quarantine, a hold or its release, or room a compaction freed: the pull says what changed
  private onControl = (heard: unknown) => {
    if (this.closed || lineageOf(heard) !== this.lineage) return

    this.hooks.controlHeard(heard as Record<string, unknown>)
    this.repair()
  }

  // A peer's caret says it has applied a row this tab has not heard
  private onPeerAhead(peerAppliedThrough: number) {
    const validRev = Number.isSafeInteger(peerAppliedThrough)
    const peerIsAhead = peerAppliedThrough > this.hooks.appliedThrough()
    const pulledRecently = Date.now() - this.lastCaretPullAt < CARET_PULL_MS
    if (!validRev || !peerIsAhead || pulledRecently) return

    this.lastCaretPullAt = Date.now()
    this.pullHoleLater(() => this.hooks.appliedThrough() < peerAppliedThrough)
  }

  private ownRowHeard() {
    this.missedOwnRows = 0
    this.updateState()
  }

  // Socket.io stops reconnecting after a few tries, so the poll loop asks again while live updates are down
  reconnect() {
    if (!this.closed && !this.socket.connected) {
      this.socket.connect?.()
    }
  }

  private wake = () => {
    if (this.closed) return

    this.reconnect()
    this.repair()
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.wake()
    }
  }

  private updateState() {
    if (this.closed) return

    const hearing = this.missedOwnRows < MAX_MISSED_OWN_ROWS && this.currentKeys().length > 0
    let state: LiveState = 'polling'
    if (this.joinAccepted && hearing) {
      state = 'live'
    } else if (Date.now() < this.joinUntil) {
      state = 'joining'
    }

    if (state === this.state) return

    this.state = state
    this.hooks.changed()
  }

  private msUntilServerTime(serverSeconds: number) {
    return Math.max(0, (serverSeconds - this.clockOffset) * 1000 - Date.now())
  }

  private runAfter(ms: number, callback: () => void) {
    const runOnce = () => {
      this.timers.delete(timer)
      callback()
    }
    const timer = setTimeout(runOnce, ms)
    this.timers.add(timer)
  }
}
