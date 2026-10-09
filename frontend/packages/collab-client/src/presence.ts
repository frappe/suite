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
  isOwnRoom(room: string): boolean
  // This tab's applied_through, sent with its caret so a peer that is behind pulls
  appliedThrough(): number
  // Whether this tab may show its caret: writers only
  showsCaret(): boolean
  // A peer has applied rows this tab has not
  peerAhead(peerAppliedThrough: number): void
}

// Another tab, by the user the realtime service verified and the rooms it shares with this one
type Member = { user: string; rooms: Set<string> }

// What the realtime service answers to this socket's room set
type RosterAnswer = { pid?: unknown; roster?: unknown; carets?: unknown } | null

// Caret states the realtime service relays for one room
type CaretBatch = { room?: unknown; states?: unknown } | null

// A tab leaving one room
type Departure = { room?: unknown; pid?: unknown } | null

type RosterEntry = { room?: unknown; pid?: unknown; user?: unknown }

// One tab's caret state, clocked by the service's count `n`
type CaretEntry = { pid?: unknown; n?: unknown; state?: unknown }

type CaretState = { cursor?: unknown; at?: unknown }

type CaretRange = { anchor?: unknown; head?: unknown }

type ItemId = { client?: unknown; clock?: unknown }

// A peer's pid, its count and the state the cursor plugin draws
type Clocked = [number, number, object]

// Who else is in the document, from the realtime service's roster and caret batches. The awareness lives
// over a scratch document whose clientID is 0, so no peer's pid or document clientID can be the local state
export class Presence {
  readonly awareness: Awareness
  private readonly members = new Map<number, Member>()
  private readonly listeners = new Set<() => void>()
  private pid = 0
  private joinedRooms: string[] = []
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private lastSentAt = 0
  private closed = false

  constructor(
    private readonly socket: LiveSocket,
    private readonly hooks: PresenceHooks,
  ) {
    const scratch = new Y.Doc()
    scratch.clientID = 0
    this.awareness = new Awareness(scratch)
    this.awareness.on('update', this.onLocalUpdate)
    socket.on('suite_collab_presence', this.onCaretBatch)
    socket.on('suite_collab_presence_join', this.onJoin)
    socket.on('suite_collab_presence_gone', this.onGone)
  }

  // Everyone else in the document now, one entry per tab
  get peers(): Peer[] {
    const toPeer = ([pid, { user }]: [number, Member]): Peer => ({
      pid,
      user,
      color: color(pid),
    })
    return [...this.members].map(toPeer)
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // The answer to this socket's room set: who is already here, and their carets
  answered(rawAnswer: unknown, rooms: string[]) {
    const answer = rawAnswer as RosterAnswer
    if (typeof answer?.pid !== 'number') {
      this.clear()
      return
    }

    this.pid = answer.pid
    this.joinedRooms = rooms.filter((room) => this.hooks.isOwnRoom(room))

    const previousPids = new Set(this.members.keys())
    this.members.clear()
    for (const entry of objectsIn(answer.roster)) {
      this.addMember(entry)
    }
    const departed = [...previousPids].filter((pid) => !this.members.has(pid))
    this.removeCarets(departed)

    this.applyCarets(objectsIn(answer.carets))
    this.sendCaret()
    this.notifyListeners()
  }

  // The socket dropped, and with it every room
  clear() {
    this.joinedRooms = []
    this.removeCarets([...this.members.keys()])
    this.members.clear()
    this.notifyListeners()
  }

  close() {
    if (this.closed) return

    this.closed = true
    if (this.sendTimer) {
      clearTimeout(this.sendTimer)
    }
    this.socket.off('suite_collab_presence', this.onCaretBatch)
    this.socket.off('suite_collab_presence_join', this.onJoin)
    this.socket.off('suite_collab_presence_gone', this.onGone)
    this.awareness.off('update', this.onLocalUpdate)
    this.awareness.destroy()
    this.listeners.clear()
  }

  private onCaretBatch = (heard: unknown) => {
    if (this.closed) return

    const message = heard as CaretBatch
    const room = message?.room
    const forThisDocument = typeof room === 'string' && this.hooks.isOwnRoom(room)
    if (!forThisDocument) return

    const inRoom = (state: object) => ({
      ...state,
      room,
    })
    const states = objectsIn(message!.states).map(inRoom)
    for (const state of states) {
      this.addMember(state)
    }
    this.applyCarets(states)
    this.notifyListeners()
  }

  private onJoin = (heard: unknown) => {
    if (this.closed || !this.addMember(heard)) return

    this.notifyListeners()
  }

  private onGone = (heard: unknown) => {
    const message = heard as Departure
    if (this.closed || typeof message?.pid !== 'number') return

    const member = this.members.get(message.pid)
    if (!member || typeof message.room !== 'string') return

    member.rooms.delete(message.room)
    if (member.rooms.size) return

    this.members.delete(message.pid)
    this.removeCarets([message.pid])
    this.notifyListeners()
  }

  // A roster entry or caret state naming one of this document's rooms
  private addMember(entry: unknown) {
    const { room, pid, user } = (entry ?? {}) as RosterEntry
    if (typeof room !== 'string' || !this.hooks.isOwnRoom(room)) return false

    const otherTab = typeof pid === 'number' && pid !== this.pid
    const named = typeof user === 'string'
    if (!otherTab || !named) return false

    const member: Member = this.members.get(pid) ?? {
      user,
      rooms: new Set<string>(),
    }
    member.rooms.add(room)
    this.members.set(pid, member)
    return true
  }

  // One awareness update for the whole batch, clocked by the service's count
  private applyCarets(states: object[]) {
    const accepted: Clocked[] = []
    for (const entry of states) {
      const { pid, n, state } = entry as CaretEntry
      const counted = typeof pid === 'number' && typeof n === 'number'
      if (!counted || !this.members.has(pid)) continue

      const { cursor, at } = (state ?? {}) as CaretState
      if (typeof at === 'number') {
        this.hooks.peerAhead(at)
      }

      const user = {
        id: this.members.get(pid)!.user,
        color: color(pid),
      }
      const shown = {
        user,
        cursor: sanitizeCaret(cursor),
      }
      accepted.push([pid, n, shown])
    }
    if (!accepted.length) return

    const update = encodeStates(accepted)
    applyAwarenessUpdate(this.awareness, update, 'remote')
  }

  private removeCarets(pids: number[]) {
    const shownPids = pids.filter((pid) => this.awareness.getStates().has(pid))
    if (shownPids.length) {
      removeAwarenessStates(this.awareness, shownPids, 'remote')
    }
  }

  // The cursor plugin moved this tab's caret, or the awareness renewed it
  private onLocalUpdate = (_: unknown, origin: unknown) => {
    if (origin !== 'local' || this.closed || this.sendTimer) return

    const sendNow = () => {
      this.sendTimer = null
      this.sendCaret()
    }
    const wait = Math.max(0, this.lastSentAt + SEND_MS - Date.now())
    this.sendTimer = setTimeout(sendNow, wait)
  }

  private sendCaret() {
    if (this.closed || !this.joinedRooms.length || !this.hooks.showsCaret()) return
    if (document.visibilityState !== 'visible') return

    const cursor = this.awareness.getLocalState()?.cursor ?? null
    this.lastSentAt = Date.now()
    const state = {
      cursor,
      at: this.hooks.appliedThrough(),
    }
    const caretMessage = {
      rooms: this.joinedRooms,
      state,
    }
    this.socket.emit('suite_collab_presence', caretMessage)
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const color = (pid: number) => COLORS[pid % COLORS.length]

// One awareness update carrying every accepted state
function encodeStates(accepted: Clocked[]) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, accepted.length)
  for (const [pid, n, state] of accepted) {
    encoding.writeVarUint(encoder, pid)
    encoding.writeVarUint(encoder, n)
    encoding.writeVarString(encoder, JSON.stringify(state))
  }
  return encoding.toUint8Array(encoder)
}

function objectsIn(raw: unknown): object[] {
  if (!Array.isArray(raw)) return []

  return raw.filter((element) => element && typeof element === 'object')
}

// Only the numbers a relative position needs reach the cursor plugin
function sanitizeCaret(cursor: unknown) {
  const { anchor: rawAnchor, head: rawHead } = (cursor ?? {}) as CaretRange
  const anchor = sanitizePosition(rawAnchor)
  const head = sanitizePosition(rawHead)
  if (!anchor || !head) return null

  return {
    anchor,
    head,
  }
}

function sanitizePosition(raw: unknown) {
  const { type, tname, item, assoc } = (raw ?? {}) as Record<string, unknown>
  const itemId = sanitizeItemId(item)
  const typeId = sanitizeItemId(type)
  if (itemId === undefined || typeId === undefined) return null

  const strayName = tname !== undefined && tname !== null && typeof tname !== 'string'
  if (strayName) return null

  // No item, no parent type and no root type name leaves nothing to anchor to
  const unanchored = !itemId && !typeId && typeof tname !== 'string'
  if (unanchored) return null

  return {
    type: typeId,
    tname: tname ?? null,
    item: itemId,
    assoc: typeof assoc === 'number' ? assoc : 0,
  }
}

function sanitizeItemId(raw: unknown) {
  if (raw === null || raw === undefined) return null

  const { client, clock } = raw as ItemId
  if (!Number.isInteger(client) || !Number.isInteger(clock)) return undefined

  return { client, clock }
}
