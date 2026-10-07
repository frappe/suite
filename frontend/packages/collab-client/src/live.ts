import type { RoomKeys, Row } from './frames'
import { Presence } from './presence'
import type { LiveSocket, LiveState } from './types'

// A key stays in use this long past its epoch, for clocks a little behind the server's
const GRACE_S = 5
// Without an answer to a join this long, the room says live updates are unavailable
const JOIN_MS = 5000
const OWN_ROW_MS = 2000
const MISSES = 3
const HOLE_MS = 1000
// A peer's caret can ask for a pull this often at most
const CARET_PULL_MS = 10_000
const ROOMS_MAX = 8
const HEARD_MAX = 256

export interface LiveHooks {
  // Rows heard over the socket, with the schema of the editor that wrote them
  rows(rows: Row[], schema?: number): void
  pull(): void
  changed(): void
  // This tab's applied_through, and whether it shows its caret
  at(): number
  sends(): boolean
}

// Rows reach the room over the realtime socket as they commit. Anything missed is pulled after a jittered
// delay, so a realtime restart doesn't send every tab to the server at once
export class Live {
  state: LiveState = 'joining'
  readonly presence: Presence
  private keys: RoomKeys | null = null
  // Server seconds minus this browser's
  private offset = 0
  private acked = false
  private members = 1
  private misses = 0
  private joinUntil = Date.now() + JOIN_MS
  private readonly heard = new Set<number>()
  private readonly awaiting = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private repairTimer: ReturnType<typeof setTimeout> | null = null
  private holeTimer: ReturnType<typeof setTimeout> | null = null
  private caretPulled = -Infinity
  private readonly hub: Hub
  private closed = false

  constructor(
    private readonly socket: LiveSocket,
    private readonly lineage: string,
    private readonly hooks: LiveHooks,
  ) {
    this.presence = new Presence(socket, {
      mine: (room) => this.current().includes(room),
      at: () => hooks.at(),
      sends: () => hooks.sends(),
      ahead: (at) => this.ahead(at),
    })
    this.hub = Hub.of(socket)
    this.hub.members.add(this)
    socket.on('suite_collab_row', this.row)
    socket.on('suite_collab_ctl', this.ctl)
    window.addEventListener('online', this.wake)
    window.addEventListener('focus', this.wake)
    document.addEventListener('visibilitychange', this.visible)
    this.after(JOIN_MS, () => this.update())
  }

  get live() {
    return this.state === 'live'
  }

  // The rooms an open or a pull named; a fresh pair is asked for early in the next epoch
  refresh(keys: RoomKeys) {
    if (this.closed) return
    this.offset = keys.server_time - Date.now() / 1000
    if (this.keys?.keys.join() === keys.keys.join()) return
    this.keys = keys
    const next = (keys.epoch + 1) * keys.epoch_seconds
    const at = next + Math.random() * 0.8 * keys.epoch_seconds
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      if (document.visibilityState === 'visible') this.hooks.pull()
    }, this.untilServer(at))
    // Each key leaves the set when its epoch ends
    for (const end of [next, next + keys.epoch_seconds])
      this.after(this.untilServer(end + GRACE_S), () => {
        this.hub.send()
        this.update()
      })
    this.hub.send()
  }

  // The keys still in use now
  current(): string[] {
    if (!this.keys || this.closed) return []
    const now = Date.now() / 1000 + this.offset
    const { epoch, epoch_seconds: span, keys } = this.keys
    return keys.filter((_, at) => now < (epoch + at + 1) * span + GRACE_S)
  }

  // A push of this tab's was committed as `rev`; its row should come back over the socket
  pushed(rev: number) {
    if (!this.acked || this.closed) return
    if (this.heard.has(rev)) return this.hit()
    this.awaiting.set(
      rev,
      setTimeout(() => {
        this.awaiting.delete(rev)
        this.misses++
        this.update()
      }, OWN_ROW_MS),
    )
  }

  // Rows wait in order behind a missing rev; if it is still missing in a second it is pulled
  hole(open: () => boolean) {
    if (this.holeTimer || this.closed) return
    this.holeTimer = setTimeout(() => {
      this.holeTimer = null
      if (open()) this.repair()
    }, HOLE_MS)
  }

  // One pull, after a random share of a delay that grows with the room
  repair() {
    if (this.repairTimer || this.closed) return
    const spread = Math.min(30_000, 50 * this.members)
    this.repairTimer = setTimeout(() => {
      this.repairTimer = null
      this.hooks.pull()
    }, Math.random() * spread)
  }

  answered(ack: unknown, rooms: string[]) {
    const mine = this.current()
    const joined = !!ack && typeof (ack as { pid?: unknown }).pid === 'number'
    this.acked = joined && mine.length > 0 && mine.every((key) => rooms.includes(key))
    if (this.acked) this.members = 1 + ((ack as { count?: number }).count ?? 0)
    if (joined) this.presence.answered(ack, rooms)
    else this.presence.clear()
    this.update()
  }

  connected() {
    this.acked = false
    this.joinUntil = Date.now() + JOIN_MS
    this.after(JOIN_MS, () => this.update())
    this.repair()
    this.update()
  }

  dropped() {
    this.acked = false
    this.presence.clear()
    this.joinUntil = Date.now() + JOIN_MS
    this.after(JOIN_MS, () => this.update())
    this.update()
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.socket.off('suite_collab_row', this.row)
    this.socket.off('suite_collab_ctl', this.ctl)
    window.removeEventListener('online', this.wake)
    window.removeEventListener('focus', this.wake)
    document.removeEventListener('visibilitychange', this.visible)
    for (const timer of [...this.timers, ...this.awaiting.values()]) clearTimeout(timer)
    for (const timer of [this.refreshTimer, this.repairTimer, this.holeTimer])
      if (timer) clearTimeout(timer)
    this.presence.close()
    this.hub.leave(this)
  }

  private row = (heard: unknown) => {
    const message = heard as Partial<Record<'lineage' | 'rev' | 'schema' | 'u', unknown>> | null
    if (this.closed || message?.lineage !== this.lineage || typeof message.rev !== 'number') return
    const rev = message.rev
    this.heard.add(rev)
    if (this.heard.size > HEARD_MAX) this.heard.delete(Math.min(...this.heard))
    const timer = this.awaiting.get(rev)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.awaiting.delete(rev)
      this.hit()
    }
    let bytes: Uint8Array | null = null
    try {
      bytes =
        typeof message.u === 'string' && typeof message.schema === 'number'
          ? decode(message.u)
          : null
    } catch {}
    if (bytes) this.hooks.rows([{ rev, bytes }], message.schema as number)
    else this.repair()
  }

  // A quarantine, a hold or its release, or room a compaction freed: the pull says what changed
  private ctl = (heard: unknown) => {
    const message = heard as { lineage?: unknown } | null
    if (this.closed || message?.lineage !== this.lineage) return
    this.repair()
  }

  // A peer's caret says it has applied a row this tab has not heard
  private ahead(at: number) {
    if (!Number.isSafeInteger(at) || at <= this.hooks.at()) return
    if (Date.now() - this.caretPulled < CARET_PULL_MS) return
    this.caretPulled = Date.now()
    this.hole(() => this.hooks.at() < at)
  }

  private hit() {
    this.misses = 0
    this.update()
  }

  // Socket.io stops reconnecting after a few tries, so the poll loop asks again while live updates are down
  retry() {
    if (!this.closed && !this.socket.connected) this.socket.connect?.()
  }

  private wake = () => {
    if (this.closed) return
    this.retry()
    this.repair()
  }

  private visible = () => {
    if (document.visibilityState === 'visible') this.wake()
  }

  private update() {
    if (this.closed) return
    const live = this.acked && this.misses < MISSES && this.current().length > 0
    const state: LiveState = live ? 'live' : Date.now() < this.joinUntil ? 'joining' : 'polling'
    if (state === this.state) return
    this.state = state
    this.hooks.changed()
  }

  private untilServer(at: number) {
    return Math.max(0, (at - this.offset) * 1000 - Date.now())
  }

  private after(ms: number, run: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      run()
    }, ms)
    this.timers.add(timer)
  }
}

// A socket's room set belongs to every document open on it, so it is sent whole
class Hub {
  private static hubs = new WeakMap<LiveSocket, Hub>()
  readonly members = new Set<Live>()
  private asked = 0

  static of(socket: LiveSocket) {
    let hub = Hub.hubs.get(socket)
    if (!hub) {
      hub = new Hub(socket)
      Hub.hubs.set(socket, hub)
    }
    return hub
  }

  private constructor(private readonly socket: LiveSocket) {
    socket.on('connect', () => {
      for (const member of this.members) member.connected()
      this.send()
    })
    socket.on('disconnect', () => {
      this.asked++
      for (const member of this.members) member.dropped()
    })
  }

  send() {
    const rooms = [...new Set([...this.members].flatMap((member) => member.current()))].slice(
      0,
      ROOMS_MAX,
    )
    const ask = ++this.asked
    if (!this.socket.connected) return
    this.socket.emit('suite_collab_rooms', { rooms }, (ack: unknown) => {
      if (ask !== this.asked) return
      for (const member of this.members) member.answered(ack, rooms)
    })
  }

  leave(member: Live) {
    this.members.delete(member)
    this.send()
  }
}

function decode(base64: string) {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at)
  return bytes
}
