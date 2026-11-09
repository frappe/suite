// Who has which elements selected, and where each outline and name tab goes

import { shallowRef, watch, type ShallowRef } from 'vue'

import { MAX_SHARED_ELEMENTS, selectionOf } from '@/apps/slides/collab/livePresence'
import type { Peer, RoomPresence } from '@/platform/collab'
import type { PeerColour } from '@/platform/collab/colours'
import {
  GUEST_USER,
  peerName,
  personIdleSince,
  personKey,
  presenceColours,
  whenNamed,
} from '@/platform/collab/peers'

export interface SelectingPerson {
  key: string
  name: string
  colour: PeerColour | undefined
  elements: string[]
  count: number
  actedAt: number
  isIdle: boolean
}

// A co-editor's selection clears around the time their delete arrives, in either order
const NAME_HOLDS_MS = 3000

export interface PeerOutline {
  elementId: string
  person: SelectingPerson
  /** What the name tab reads; null when this outline has no tab. */
  label: string | null
}

function labelOf(person: SelectingPerson) {
  if (person.count > MAX_SHARED_ELEMENTS) {
    return `${person.name} · ${person.count} elements`
  }

  return person.name
}

/** One outline per element on this slide, and at most one name tab for each person. */
export function outlinesOn(people: SelectingPerson[], shownIds: Set<string>): PeerOutline[] {
  const mostRecentFirst = [...people].sort((one, other) => other.actedAt - one.actedAt)
  const peopleOn = new Map<string, SelectingPerson[]>()
  for (const person of mostRecentFirst) {
    for (const id of person.elements.filter((element) => shownIds.has(element))) {
      peopleOn.set(id, [...(peopleOn.get(id) ?? []), person])
    }
  }

  const outlines = new Map<string, PeerOutline>()
  for (const [elementId, [person, ...others]] of peopleOn) {
    const label = others.length ? `${person.name} & ${others.length} more` : null
    outlines.set(elementId, { elementId, person, label })
  }

  const hasTab = new Set(
    [...outlines.values()].flatMap(({ person, label }) => (label ? [person] : [])),
  )
  for (const person of mostRecentFirst) {
    const first = person.elements.find((element) => shownIds.has(element))
    const outline = first && outlines.get(first)
    if (outline && outline.person === person && !hasTab.has(person)) {
      outline.label = labelOf(person)
    }
  }

  return [...outlines.values()]
}

/** Answers who has, or just had, an element selected: the best guess at who deleted it. */
export function lastSelector(people: ShallowRef<SelectingPerson[]>) {
  const last = new Map<string, { name: string; lostAt: number | null }>()

  function hasExpired(lostAt: number | null) {
    return lostAt !== null && Date.now() - lostAt > NAME_HOLDS_MS
  }

  watch(
    people,
    (selecting) => {
      const holders = new Map<string, string>()
      for (const { name, elements } of [...selecting].sort((a, b) => a.actedAt - b.actedAt)) {
        elements.forEach((id) => holders.set(id, name))
      }

      for (const [id, seen] of last) {
        seen.lostAt ??= Date.now()
        if (hasExpired(seen.lostAt)) {
          last.delete(id)
        }
      }

      holders.forEach((name, id) => last.set(id, { name, lostAt: null }))
    },
    { immediate: true, flush: 'sync' },
  )

  return (elementId: string) => {
    const seen = last.get(elementId)
    return seen && !hasExpired(seen.lostAt) ? seen.name : null
  }
}

function shownName(peer: Peer) {
  const name = peerName(peer.user, peer.pid)
  if (peer.user === GUEST_USER) {
    return name
  }

  return name.split(' ')[0]
}

/** Everyone else with elements selected, one entry per person, kept up to date with the room. */
export function usePeopleSelecting(presenceRef: ShallowRef<RoomPresence | null>) {
  const people = shallowRef<SelectingPerson[]>([])
  const lastActed = new Map<number, { cursor: string; at: number }>()
  const namesAsked = new Set<string>()

  function actedAt(pid: number, activity: unknown) {
    const seen = JSON.stringify(activity)
    const known = lastActed.get(pid)
    if (known?.cursor === seen) {
      return known.at
    }

    const at = Date.now()
    lastActed.set(pid, { cursor: seen, at })
    return at
  }

  function read(presence: RoomPresence, refresh: () => void) {
    const colours = presenceColours(presence)
    const states = presence.awareness.getStates()
    const byPerson = new Map<string, SelectingPerson>()
    for (const peer of presence.peers) {
      const cursor = states.get(peer.pid)?.cursor
      const selection = selectionOf(cursor)
      if (!selection) {
        continue
      }

      if (!namesAsked.has(peer.user)) {
        namesAsked.add(peer.user)
        void whenNamed(peer.user, refresh)
      }

      const key = personKey(peer.user, peer.pid)
      const person = {
        key,
        name: shownName(peer),
        colour: colours.get(peer.pid),
        ...selection,
        actedAt: actedAt(peer.pid, [cursor, states.get(peer.pid)?.typed ?? null]),
        isIdle: personIdleSince(presence.peers, peer.pid) !== null,
      }
      const known = byPerson.get(key)
      if (!known || person.actedAt > known.actedAt) {
        byPerson.set(key, person)
      }
    }

    return [...byPerson.values()]
  }

  watch(
    presenceRef,
    (presence, _, onCleanup) => {
      people.value = []
      lastActed.clear()
      if (!presence) {
        return
      }

      const room = presence
      function refresh() {
        people.value = read(room, refresh)
      }

      const stopPeers = room.onChange(refresh)
      room.awareness.on('change', refresh)
      refresh()
      onCleanup(() => {
        stopPeers()
        room.awareness.off('change', refresh)
      })
    },
    { immediate: true },
  )

  return people
}
