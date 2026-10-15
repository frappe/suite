import { decodeBase64 } from './bytes'

// What the realtime service answers to this socket's room set
export interface JoinAnswer {
  pid: number
  arrival: number | null
  count: number
  roster: object[]
  carets: object[]
}

// A row's bytes, with the schema of the editor that wrote them
interface RowContent {
  bytes: Uint8Array
  schema: number
}

// A row as the realtime service relays it
export interface HeardRow {
  rev: number
  // Null when the row came without its bytes, or with bytes that aren't base64
  content: RowContent | null
}

// A tab in one of the rooms, by the user the realtime service verified
export interface HeardMember {
  room: string
  pid: number
  user: string
  arrival: number | null
}

// Caret states the realtime service relays for one room
export interface CaretBatch {
  room: string
  states: object[]
}

// One tab's caret state, clocked by the service's count
export interface HeardCaret {
  pid: number
  clock: number
  cursor: unknown
  // How many edits the tab has made, so a peer sees it typing while its caret's stored position stays put
  typed: number
  at: number | null
  // How long the tab has been without input once it went idle, and how long it has been hidden
  idleFor: number | null
  hiddenFor: number | null
}

// A tab leaving one room
export interface Departure {
  room: string
  pid: number
}

// A payload's fields, none when it isn't an object
function fieldsOf(heard: unknown): Record<string, unknown> {
  return heard && typeof heard === 'object' ? (heard as Record<string, unknown>) : {}
}

function objectsIn(raw: unknown): object[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter((element) => element && typeof element === 'object')
}

// When the realtime service saw a tab connect; null from a service that doesn't count arrivals
function arrivalOf(raw: unknown) {
  return typeof raw === 'number' ? raw : null
}

function decodedOrNull(base64: string) {
  try {
    return decodeBase64(base64)
  } catch {
    return null
  }
}

export function parseJoinAnswer(heard: unknown): JoinAnswer | null {
  const { pid, arrival, count, roster, carets } = fieldsOf(heard)
  if (typeof pid !== 'number') {
    return null
  }

  return {
    pid,
    arrival: arrivalOf(arrival),
    count: typeof count === 'number' ? count : 0,
    roster: objectsIn(roster),
    carets: objectsIn(carets),
  }
}

// Null for another document's row, so its bytes are never decoded here
export function parseRow(heard: unknown, lineage: string): HeardRow | null {
  const { lineage: rowLineage, rev, schema, u } = fieldsOf(heard)
  if (rowLineage !== lineage || typeof rev !== 'number') {
    return null
  }

  let content: RowContent | null = null
  if (typeof u === 'string' && typeof schema === 'number') {
    const bytes = decodedOrNull(u)
    content = bytes && { bytes, schema }
  }
  return {
    rev,
    content,
  }
}

export function lineageOf(heard: unknown) {
  return fieldsOf(heard).lineage
}

export function parseMember(heard: unknown): HeardMember | null {
  const { room, pid, user, arrival } = fieldsOf(heard)
  const isMember = typeof room === 'string' && typeof pid === 'number' && typeof user === 'string'
  if (!isMember) {
    return null
  }

  return { room, pid, user, arrival: arrivalOf(arrival) }
}

export function parseCaretBatch(heard: unknown): CaretBatch | null {
  const { room, states } = fieldsOf(heard)
  if (typeof room !== 'string') {
    return null
  }

  return {
    room,
    states: objectsIn(states),
  }
}

export function parseCaret(heard: unknown): HeardCaret | null {
  const { pid, n: clock, state } = fieldsOf(heard)
  if (typeof pid !== 'number' || typeof clock !== 'number') {
    return null
  }

  const { cursor, typed, at, idleFor, hiddenFor } = fieldsOf(state)
  return {
    pid,
    clock,
    cursor,
    typed: Number(typed) || 0,
    at: typeof at === 'number' ? at : null,
    idleFor: durationOf(idleFor),
    hiddenFor: durationOf(hiddenFor),
  }
}

function durationOf(heard: unknown) {
  const isDuration = typeof heard === 'number' && Number.isFinite(heard) && heard >= 0
  if (!isDuration) {
    return null
  }

  return heard
}

export function parseDeparture(heard: unknown): Departure | null {
  const { room, pid } = fieldsOf(heard)
  if (typeof room !== 'string' || typeof pid !== 'number') {
    return null
  }

  return {
    room,
    pid,
  }
}
