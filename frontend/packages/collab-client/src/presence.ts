import * as encoding from 'lib0/encoding'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as yjs from 'yjs'

import {
  parseCaret,
  parseCaretBatch,
  parseDeparture,
  parseMember,
  type HeardCaret,
  type JoinAnswer,
} from './payloads'
import type { LiveSocket, Peer } from './types'

// Carets go out trailing-edge, at most ten a second
const SEND_MS = 100
// A tab without input for five minutes is idle, and one hidden a minute counts as idle from when it was hidden;
// a hidden tab sends nothing more, so its caret goes 30 s after it was hidden
const IDLE_MS = 300_000
const HIDDEN_IDLE_MS = 60_000
const HIDDEN_CARET_MS = 30_000
const INPUTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']

export interface PresenceHooks {
  // Whether a room is one of this document's
  isOwnRoom(room: string): boolean
  // This tab's applied_through, sent with its caret so a peer that is behind pulls
  appliedThrough(): number
  // Whether this tab may show its caret: writers only
  showsCaret(): boolean
  // A peer's position as the app draws it, or null
  position(raw: unknown): object | null
  // A peer has applied rows this tab has not
  peerAhead(peerAppliedThrough: number): void
}

// Another tab, by the user the realtime service verified and the rooms it shares with this one
interface Member {
  user: string
  arrival: number | null
  rooms: Set<string>
  // On this tab's clock, from the durations the tab last sent
  idleSince: number | null
  hiddenSince: number | null
}

// A peer's pid, its count and the state the cursor plugin draws
type Clocked = [number, number, object]

// Who else is in the document, from the realtime service's roster and caret batches. The awareness lives
// over a scratch document whose clientID is 0, so no peer's pid or document clientID can be the local state
export class Presence {
  readonly awareness: Awareness
  private readonly members = new Map<number, Member>()
  private readonly listeners = new Set<() => void>()
  private pid = 0
  private arrival: number | null = null
  private joinedRooms: string[] = []
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private lastSentAt = 0
  private closed = false
  private lastInputAt = Date.now()
  private hiddenAt: number | null = null
  private isIdle = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private wakeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly socket: LiveSocket,
    private readonly hooks: PresenceHooks,
  ) {
    const scratch = new yjs.Doc()
    scratch.clientID = 0
    this.awareness = new Awareness(scratch)
    this.awareness.on('update', this.onLocalUpdate)
    socket.on('suite_collab_presence', this.onCaretBatch)
    socket.on('suite_collab_presence_join', this.onJoin)
    socket.on('suite_collab_presence_gone', this.onGone)
    for (const input of INPUTS) {
      window.addEventListener(input, this.onInput, { capture: true, passive: true })
    }

    document.addEventListener('visibilitychange', this.onVisibilityChange)
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now()
    }

    this.armIdleTimer()
  }

  // Everyone else in the document now, one entry per tab
  get peers(): Peer[] {
    const now = Date.now()
    return [...this.members].map(([pid, member]): Peer => ({
      pid,
      user: member.user,
      arrival: member.arrival,
      idleSince: tabIdleSince(member, now),
    }))
  }

  get ownPid() {
    return this.pid
  }

  get ownArrival() {
    return this.arrival
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // The answer to this socket's room set: who is already here, and their carets
  answered(answer: JoinAnswer | null, rooms: string[]) {
    if (!answer) {
      this.clear()
      return
    }

    this.pid = answer.pid
    this.arrival = answer.arrival
    this.joinedRooms = rooms.filter((room) => this.hooks.isOwnRoom(room))

    const previousPids = new Set(this.members.keys())
    this.members.clear()
    for (const entry of answer.roster) {
      this.addMember(entry)
    }

    const departed = [...previousPids].filter((pid) => !this.members.has(pid))
    this.removeCarets(departed)

    this.applyCarets(answer.carets)
    this.announce()
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
    for (const timer of [this.sendTimer, this.idleTimer, this.wakeTimer]) {
      if (timer) {
        clearTimeout(timer)
      }
    }

    for (const input of INPUTS) {
      window.removeEventListener(input, this.onInput, { capture: true })
    }

    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.socket.off('suite_collab_presence', this.onCaretBatch)
    this.socket.off('suite_collab_presence_join', this.onJoin)
    this.socket.off('suite_collab_presence_gone', this.onGone)
    this.awareness.off('update', this.onLocalUpdate)
    this.awareness.destroy()
    this.listeners.clear()
  }

  private onCaretBatch = (heard: unknown) => {
    if (this.closed) return

    const batch = parseCaretBatch(heard)
    if (!batch || !this.hooks.isOwnRoom(batch.room)) return

    const room = batch.room
    function inRoom(state: object) {
      return { ...state, room }
    }

    const states = batch.states.map(inRoom)
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
    const departure = parseDeparture(heard)
    if (this.closed || !departure) return

    const member = this.members.get(departure.pid)
    if (!member) return

    member.rooms.delete(departure.room)
    if (member.rooms.size) return

    this.members.delete(departure.pid)
    this.removeCarets([departure.pid])
    this.notifyListeners()
  }

  // A roster entry or caret state naming one of this document's rooms
  private addMember(entry: unknown) {
    const heardMember = parseMember(entry)
    const isOtherTab = heardMember?.pid !== this.pid
    if (!heardMember || !isOtherTab || !this.hooks.isOwnRoom(heardMember.room)) {
      return false
    }

    const { room, pid, user, arrival } = heardMember
    const member: Member = this.members.get(pid) ?? {
      user,
      arrival,
      rooms: new Set<string>(),
      idleSince: null,
      hiddenSince: null,
    }
    member.arrival ??= arrival
    member.rooms.add(room)
    this.members.set(pid, member)
    return true
  }

  private acceptCaret(caret: HeardCaret, now: number): Clocked | null {
    const { pid, clock, cursor, typed, at, idleFor, hiddenFor } = caret
    const member = this.members.get(pid)
    if (!member) {
      return null
    }

    if (at !== null) {
      this.hooks.peerAhead(at)
    }

    member.idleSince = startOf(idleFor, now)
    member.hiddenSince = startOf(hiddenFor, now)
    if (caretLapsed(member, now)) {
      this.removeCarets([pid])
      return null
    }

    const user = { id: member.user }
    const shown = {
      user,
      cursor: this.hooks.position(cursor),
      typed,
    }
    return [pid, clock, shown]
  }

  // One awareness update for the whole batch, clocked by the service's count
  private applyCarets(states: object[]) {
    const accepted: Clocked[] = []
    const carets = states.map(parseCaret).filter((caret): caret is HeardCaret => !!caret)
    const now = Date.now()
    for (const caret of carets) {
      const clocked = this.acceptCaret(caret, now)
      if (clocked) {
        accepted.push(clocked)
      }
    }

    this.wakeWhenHiddenTurnsIdle()
    if (!accepted.length) return

    const update = encodeStates(accepted)
    applyAwarenessUpdate(this.awareness, update, 'remote')
  }

  // A hidden tab sends nothing more, so this tab wakes itself when one has been hidden long enough to lose its
  // caret, and again when it turns idle
  private wakeWhenHiddenTurnsIdle() {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }

    const now = Date.now()
    const turns = [...this.members.values()]
      .map(({ hiddenSince }) => hiddenSince ?? -Infinity)
      .flatMap((since) => [since + HIDDEN_CARET_MS, since + HIDDEN_IDLE_MS])
      .filter((turnsAt) => turnsAt > now)
    if (!turns.length) return

    const wake = () => {
      this.wakeTimer = null
      const lapsed = [...this.members]
        .filter(([, member]) => caretLapsed(member, Date.now()))
        .map(([pid]) => pid)
      this.removeCarets(lapsed)
      this.wakeWhenHiddenTurnsIdle()
      this.notifyListeners()
    }

    this.wakeTimer = setTimeout(wake, Math.min(...turns) - now)
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
    if (!this.hooks.showsCaret() || document.visibilityState !== 'visible') return

    this.sendState()
  }

  // A tab that is away says so on joining, even one that shows no caret
  private announce() {
    if (this.isIdle || this.hiddenAt !== null) {
      this.sendState()
      return
    }

    this.sendCaret()
  }

  // Every tab, viewers and hidden tabs too, sends its state once when it goes idle or hidden and once when it
  // comes back
  private sendState() {
    if (this.closed || !this.joinedRooms.length) return

    const local = this.awareness.getLocalState()
    const now = Date.now()
    this.lastSentAt = now
    let cursor = null
    if (this.hooks.showsCaret()) {
      cursor = local?.cursor ?? null
    }

    const state = {
      cursor,
      typed: local?.typed ?? 0,
      at: this.hooks.appliedThrough(),
      idleFor: durationSince(this.idleStart, now),
      hiddenFor: durationSince(this.hiddenAt, now),
    }
    this.socket.emit('suite_collab_presence', { rooms: this.joinedRooms, state })
  }

  private get idleStart() {
    if (!this.isIdle) {
      return null
    }

    return this.lastInputAt
  }

  private onInput = () => {
    this.lastInputAt = Date.now()
    if (!this.isIdle) return

    this.isIdle = false
    this.armIdleTimer()
    this.sendState()
  }

  private armIdleTimer() {
    const wait = this.lastInputAt + IDLE_MS - Date.now()
    this.idleTimer = setTimeout(this.onIdleCheck, Math.max(0, wait))
  }

  private onIdleCheck = () => {
    this.idleTimer = null
    if (Date.now() - this.lastInputAt < IDLE_MS) {
      this.armIdleTimer()
      return
    }

    this.isIdle = true
    this.sendState()
  }

  private onVisibilityChange = () => {
    const isHidden = document.visibilityState === 'hidden'
    if (isHidden === (this.hiddenAt !== null)) return

    this.hiddenAt = null
    if (isHidden) {
      this.hiddenAt = Date.now()
    }

    this.sendState()
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

// When a tab went idle: once its person stopped, or once it had been hidden a minute, counted from hiding
function tabIdleSince({ idleSince, hiddenSince }: Member, now: number) {
  const starts = [idleSince]
  if (hiddenSince !== null && now - hiddenSince >= HIDDEN_IDLE_MS) {
    starts.push(hiddenSince)
  }

  const known = starts.filter((start): start is number => start !== null)
  if (!known.length) {
    return null
  }

  return Math.min(...known)
}

function caretLapsed({ hiddenSince }: Member, now: number) {
  return hiddenSince !== null && now - hiddenSince >= HIDDEN_CARET_MS
}

function startOf(duration: number | null, now: number) {
  if (duration === null) {
    return null
  }

  return now - duration
}

function durationSince(start: number | null, now: number) {
  if (start === null) {
    return null
  }

  return now - start
}

// One awareness update carrying every accepted state
function encodeStates(accepted: Clocked[]) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, accepted.length)
  for (const [pid, clock, state] of accepted) {
    encoding.writeVarUint(encoder, pid)
    encoding.writeVarUint(encoder, clock)
    encoding.writeVarString(encoder, JSON.stringify(state))
  }

  return encoding.toUint8Array(encoder)
}
