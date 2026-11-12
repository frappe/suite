// What this tab shows others on a slide: its text caret and its selected elements,
// sent together as one peer position. The caret plugin only ever sees the caret

import type { Awareness } from 'y-protocols/awareness'

import type { RoomPresence } from '@/platform/collab'

export const MAX_SHARED_ELEMENTS = 20

const CURSOR = 'cursor'

interface PeerState {
  [CURSOR]?: unknown
  [field: string]: unknown
}

interface Caret {
  anchor: unknown
  head: unknown
}

function caretOf(cursor: unknown): Caret | null {
  if (!cursor || typeof cursor !== 'object' || !('anchor' in cursor) || !('head' in cursor)) {
    return null
  }

  return { anchor: cursor.anchor, head: cursor.head }
}

function caretOnly(state: PeerState): PeerState {
  return { ...state, [CURSOR]: caretOf(state[CURSOR]) }
}

/** Splits the room's one peer position into the caret and the selected elements. */
export function sharedPresence(presence: RoomPresence) {
  const { awareness } = presence
  let caret: Caret | null = null
  let selected: string[] = []

  function publish() {
    const selection = selected.length
      ? { elements: selected.slice(0, MAX_SHARED_ELEMENTS), count: selected.length }
      : null
    const position = caret || selection ? { ...caret, ...selection } : null
    awareness.setLocalStateField(CURSOR, position)
  }

  // the room's own awareness for everything but the caret, its events above all
  const caretAwareness: Awareness = Object.assign(Object.create(awareness), {
    getStates() {
      const states = new Map<number, PeerState>()
      awareness.getStates().forEach((state, id) => states.set(id, caretOnly(state)))
      return states
    },
    getLocalState() {
      const state = awareness.getLocalState()
      return state && caretOnly(state)
    },
    setLocalStateField(field: string, value: unknown) {
      if (field !== CURSOR) {
        awareness.setLocalStateField(field, value)
        return
      }

      caret = caretOf(value)
      publish()
    },
  })

  const textPresence: RoomPresence = {
    awareness: caretAwareness,
    get peers() {
      return presence.peers
    },
    get ownPid() {
      return presence.ownPid
    },
    get ownArrival() {
      return presence.ownArrival
    },
    onChange: (listener) => presence.onChange(listener),
  }

  return {
    textPresence,
    publishSelection(ids: string[]) {
      selected = ids
      publish()
    },
  }
}

/** A peer's selected elements from the peer position it sent, or null. */
export function selectionOf(cursor: unknown) {
  if (!cursor || typeof cursor !== 'object' || !('elements' in cursor) || !('count' in cursor)) {
    return null
  }

  const { elements, count } = cursor
  if (!Array.isArray(elements) || typeof count !== 'number') {
    return null
  }

  return { elements: elements.filter((id): id is string => typeof id === 'string'), count }
}
