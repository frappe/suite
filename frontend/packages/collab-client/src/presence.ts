import * as encoding from 'lib0/encoding'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { LiveSocket, Peer } from './types'

// Carets go out trailing-edge, at most ten a second
const SEND_MS = 100
const COLORS = [
  '#E5484D',
  '#D6409F',
  '#8E4EC6',
  '#3E63DD',
  '#0090FF',
  '#12A594',
  '#30A46C',
  '#F76B15',
]

export interface PresenceHooks {
  // Whether a room is one of this document's
  mine(room: string): boolean
  // This tab's applied_through, sent with its caret so a peer that is behind pulls
  at(): number
  // Whether this tab may show its caret: writers only
  sends(): boolean
  // A peer has applied rows this tab has not
  ahead(at: number): void
}

// Who else is in the document, from the realtime service's roster and caret batches. The awareness lives
// over a scratch document whose clientID is 0, so no peer's pid or document clientID can be the local state
export class Presence {
  readonly awareness: Awareness
  private readonly members = new Map<number, { user: string; rooms: Set<string> }>()
  private readonly listeners = new Set<() => void>()
  private pid = 0
  private joined: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private sent = 0
  private closed = false

  constructor(
    private readonly socket: LiveSocket,
    private readonly hooks: PresenceHooks,
  ) {
    const scratch = new Y.Doc()
    scratch.clientID = 0
    this.awareness = new Awareness(scratch)
    this.awareness.on('update', this.local)
    socket.on('suite_collab_presence', this.batch)
    socket.on('suite_collab_presence_join', this.join)
    socket.on('suite_collab_presence_gone', this.gone)
  }

  // Everyone else in the document now, one entry per tab
  get peers(): Peer[] {
    return [...this.members].map(([pid, { user }]) => ({ pid, user }))
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // The answer to this socket's room set: who is already here, and their carets
  answered(ack: unknown, rooms: string[]) {
    const answer = ack as { pid?: unknown; roster?: unknown; carets?: unknown } | null
    if (typeof answer?.pid !== 'number') return this.clear()
    this.pid = answer.pid
    this.joined = rooms.filter((room) => this.hooks.mine(room))
    const before = new Set(this.members.keys())
    this.members.clear()
    for (const entry of list(answer.roster)) this.enter(entry)
    this.drop([...before].filter((pid) => !this.members.has(pid)))
    this.apply(list(answer.carets))
    this.send()
    this.emit()
  }

  // The socket dropped, and with it every room
  clear() {
    this.joined = []
    this.drop([...this.members.keys()])
    this.members.clear()
    this.emit()
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.socket.off('suite_collab_presence', this.batch)
    this.socket.off('suite_collab_presence_join', this.join)
    this.socket.off('suite_collab_presence_gone', this.gone)
    this.awareness.off('update', this.local)
    this.awareness.destroy()
    this.listeners.clear()
  }

  private batch = (heard: unknown) => {
    const message = heard as { room?: unknown; states?: unknown } | null
    if (this.closed || typeof message?.room !== 'string' || !this.hooks.mine(message.room)) return
    const states = list(message.states).map((state) => ({ ...state, room: message.room }))
    for (const state of states) this.enter(state)
    this.apply(states)
    this.emit()
  }

  private join = (heard: unknown) => {
    if (this.closed || !this.enter(heard)) return
    this.emit()
  }

  private gone = (heard: unknown) => {
    const message = heard as { room?: unknown; pid?: unknown } | null
    if (this.closed || typeof message?.pid !== 'number') return
    const member = this.members.get(message.pid)
    if (!member || typeof message.room !== 'string') return
    member.rooms.delete(message.room)
    if (member.rooms.size) return
    this.members.delete(message.pid)
    this.drop([message.pid])
    this.emit()
  }

  // A roster entry or caret state naming one of this document's rooms
  private enter(entry: unknown) {
    const { room, pid, user } = (entry ?? {}) as { room?: unknown; pid?: unknown; user?: unknown }
    if (typeof room !== 'string' || !this.hooks.mine(room)) return false
    if (typeof pid !== 'number' || pid === this.pid || typeof user !== 'string') return false
    const member = this.members.get(pid) ?? { user, rooms: new Set<string>() }
    member.rooms.add(room)
    this.members.set(pid, member)
    return true
  }

  // One awareness update for the whole batch, clocked by the service's count
  private apply(states: object[]) {
    const accepted: [number, number, object][] = []
    for (const entry of states) {
      const { pid, n, state } = entry as { pid?: unknown; n?: unknown; state?: unknown }
      if (typeof pid !== 'number' || typeof n !== 'number' || !this.members.has(pid)) continue
      const { cursor, at } = (state ?? {}) as { cursor?: unknown; at?: unknown }
      if (typeof at === 'number') this.hooks.ahead(at)
      const user = { id: this.members.get(pid)!.user, color: COLORS[pid % COLORS.length] }
      accepted.push([pid, n, { user, cursor: caret(cursor) }])
    }
    if (!accepted.length) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, accepted.length)
    for (const [pid, n, state] of accepted) {
      encoding.writeVarUint(encoder, pid)
      encoding.writeVarUint(encoder, n)
      encoding.writeVarString(encoder, JSON.stringify(state))
    }
    applyAwarenessUpdate(this.awareness, encoding.toUint8Array(encoder), 'remote')
  }

  private drop(pids: number[]) {
    const held = pids.filter((pid) => this.awareness.getStates().has(pid))
    if (held.length) removeAwarenessStates(this.awareness, held, 'remote')
  }

  // The cursor plugin moved this tab's caret, or the awareness renewed it
  private local = (_: unknown, origin: unknown) => {
    if (origin !== 'local' || this.closed || this.timer) return
    this.timer = setTimeout(
      () => {
        this.timer = null
        this.send()
      },
      Math.max(0, this.sent + SEND_MS - Date.now()),
    )
  }

  private send() {
    if (this.closed || !this.joined.length || !this.hooks.sends()) return
    if (document.visibilityState !== 'visible') return
    const cursor = this.awareness.getLocalState()?.cursor ?? null
    this.sent = Date.now()
    this.socket.emit('suite_collab_presence', {
      rooms: this.joined,
      state: { cursor, at: this.hooks.at() },
    })
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

function list(value: unknown): object[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

// Only the numbers a relative position needs reach the cursor plugin
function caret(cursor: unknown) {
  const { anchor, head } = (cursor ?? {}) as { anchor?: unknown; head?: unknown }
  const from = position(anchor)
  const to = position(head)
  return from && to ? { anchor: from, head: to } : null
}

function position(value: unknown) {
  const { type, tname, item, assoc } = (value ?? {}) as Record<string, unknown>
  const at = id(item)
  const parent = id(type)
  if (at === undefined || parent === undefined) return null
  if (tname !== undefined && tname !== null && typeof tname !== 'string') return null
  if (!at && !parent && typeof tname !== 'string') return null
  return {
    type: parent,
    tname: tname ?? null,
    item: at,
    assoc: typeof assoc === 'number' ? assoc : 0,
  }
}

function id(value: unknown) {
  if (value === null || value === undefined) return null
  const { client, clock } = value as { client?: unknown; clock?: unknown }
  return Number.isInteger(client) && Number.isInteger(clock) ? { client, clock } : undefined
}
