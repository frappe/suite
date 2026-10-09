import type { RoomKeys, Row } from './frames'
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
const ROOMS_MAX = 8
const HEARD_MAX = 256

export interface LiveHooks {
  // Rows heard over the socket, with the schema of the editor that wrote them
  heardRows(rows: Row[], schema?: number): void
  pull(): void
  changed(): void
  // This tab's applied_through, and whether it shows its caret
  appliedThrough(): number
  showsCaret(): boolean
}

// What the realtime service answers to a join
type JoinAnswer = { pid?: unknown; count?: number } | null

// A row as the realtime service relays it
type HeardRow = Partial<Record<'lineage' | 'rev' | 'schema' | 'u', unknown>> | null

// Rows reach the room over the realtime socket as they commit. Anything missed is pulled after a jittered
// delay, so a realtime restart doesn't send every tab to the server at once
export class Live {
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
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private repairTimer: ReturnType<typeof setTimeout> | null = null
  private holeTimer: ReturnType<typeof setTimeout> | null = null
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
      this.refreshTimer = null
      if (document.visibilityState === 'visible') {
        this.hooks.pull()
      }
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
    }
    this.refreshTimer = setTimeout(pullIfVisible, this.msUntilServerTime(refreshAt))

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
    if (!this.keys || this.closed) return []

    const now = Date.now() / 1000 + this.clockOffset
    const { epoch, epoch_seconds: epochSeconds, keys } = this.keys
    return keys.filter((_, at) => now < (epoch + at + 1) * epochSeconds + GRACE_S)
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
    if (this.holeTimer || this.closed) return

    const repairIfStillMissing = () => {
      this.holeTimer = null
      if (stillMissing()) {
        this.repair()
      }
    }
    this.holeTimer = setTimeout(repairIfStillMissing, HOLE_MS)
  }

  // One pull, after a random share of a delay that grows with the room
  repair() {
    if (this.repairTimer || this.closed) return

    const spread = Math.min(30_000, 50 * this.memberCount)
    const pull = () => {
      this.repairTimer = null
      this.hooks.pull()
    }
    this.repairTimer = setTimeout(pull, Math.random() * spread)
  }

  answered(rawAnswer: unknown, rooms: string[]) {
    const answer = rawAnswer as JoinAnswer
    const ownKeys = this.currentKeys()
    const joined = !!answer && typeof answer.pid === 'number'
    const inAllRooms = ownKeys.length > 0 && ownKeys.every((key) => rooms.includes(key))

    this.joinAccepted = joined && inAllRooms
    if (this.joinAccepted) {
      this.memberCount = 1 + (answer!.count ?? 0)
    }

    if (joined) {
      this.presence.answered(rawAnswer, rooms)
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
    for (const timer of [this.refreshTimer, this.repairTimer, this.holeTimer]) {
      if (timer) {
        clearTimeout(timer)
      }
    }

    this.presence.close()
    this.hub.leave(this)
  }

  private onRowHeard = (heard: unknown) => {
    const message = heard as HeardRow
    const ours = message?.lineage === this.lineage
    if (this.closed || !ours || typeof message?.rev !== 'number') return

    const rev = message.rev

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
    let bytes: Uint8Array | null = null
    if (typeof message.u === 'string' && typeof message.schema === 'number') {
      try {
        bytes = decodeBase64(message.u)
      } catch {}
    }

    if (bytes) {
      this.hooks.heardRows([{ rev, bytes }], message.schema as number)
    } else {
      this.repair()
    }
  }

  // A quarantine, a hold or its release, or room a compaction freed: the pull says what changed
  private onControl = (heard: unknown) => {
    const message = heard as { lineage?: unknown } | null
    if (this.closed || message?.lineage !== this.lineage) return

    this.repair()
  }

  // A peer's caret says it has applied a row this tab has not heard
  private onPeerAhead(peerAppliedThrough: number) {
    if (
      !Number.isSafeInteger(peerAppliedThrough) ||
      peerAppliedThrough <= this.hooks.appliedThrough()
    )
      return

    if (Date.now() - this.lastCaretPullAt < CARET_PULL_MS) return

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

// A socket's room set belongs to every document open on it, so it is sent whole
class Hub {
  private static hubs = new WeakMap<LiveSocket, Hub>()
  readonly members = new Set<Live>()
  private roomSetVersion = 0

  static forSocket(socket: LiveSocket) {
    let hub = Hub.hubs.get(socket)
    if (!hub) {
      hub = new Hub(socket)
      Hub.hubs.set(socket, hub)
    }
    return hub
  }

  private constructor(private readonly socket: LiveSocket) {
    const connected = () => {
      for (const member of this.members) {
        member.connected()
      }
      this.sendRoomSet()
    }
    const dropped = () => {
      this.roomSetVersion++
      for (const member of this.members) {
        member.dropped()
      }
    }
    socket.on('connect', connected)
    socket.on('disconnect', dropped)
  }

  sendRoomSet() {
    const keys = [...this.members].flatMap((member) => member.currentKeys())
    const rooms = [...new Set(keys)].slice(0, ROOMS_MAX)
    const version = ++this.roomSetVersion
    if (!this.socket.connected) return

    const answered = (rawAnswer: unknown) => {
      if (version !== this.roomSetVersion) return

      for (const member of this.members) {
        member.answered(rawAnswer, rooms)
      }
    }
    this.socket.emit('suite_collab_rooms', { rooms }, answered)
  }

  leave(member: Live) {
    this.members.delete(member)
    this.sendRoomSet()
  }
}

function decodeBase64(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) {
    bytes[at] = binary.charCodeAt(at)
  }
  return bytes
}
