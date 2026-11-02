// Who else has the spreadsheet open, as the editor draws them (like Google
// Sheets): an avatar each in the header, and each editor's selected range
// outlined in their colour on the sheet they are on, their name on hover.
// Viewers get an avatar but no box: the room sends a tab's selection only
// while it can write.
//
// A tab sends its selection by row/col ids (selection.ts), so a peer's box
// stays on its cells when someone inserts rows above it.

import type * as Y from 'yjs'

import type { Peer, RoomPresence } from '@/platform/collab'
import { assignColours } from '@/platform/collab/colours'

import { readSavedSelection, selectionFromIds, selectionToIds, type Selection } from './selection'

export const GUEST_USER = 'Guest'

/** An avatar in the header (SheetTopbarActions, SheetTabsBar). */
export interface PresentUser {
  user: string
  full_name: string
  first_name: string
  initials: string
  user_image: string
  color: string
  /** The sheet they are on; null for a viewer, whose selection isn't sent. */
  sub_sheet: string | null
}

/** A peer's selected range, drawn over the grid (0-based). */
export interface RemoteCursor {
  row: number
  col: number
  range: { r0: number; c0: number; r1: number; c1: number }
  subSheet: string
  color: string
  fullName: string
  firstName: string
  initials: string
}

/** A person's name and picture; their user id until it is known. */
export interface Person {
  fullName: string
  image: string
}

// Who a tab belongs to; every guest tab is its own person.
const personKey = (user: string, pid: number) => (user === GUEST_USER ? `Guest ${pid}` : user)

function nameOf(user: string, pid: number, person: (user: string) => Person): Person {
  if (user === GUEST_USER) {
    return { fullName: `Guest ${pid.toString(36).slice(-4).toUpperCase()}`, image: '' }
  }
  return person(user)
}

function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/**
 * Each tab's colour. People rank by their first tab's arrival, then by key, so
 * every tab ranks the same people the same way (as Writer's carets).
 */
export function peerColours(peers: Peer[], own: Peer): Map<number, string> {
  const first = new Map<string, number>()
  for (const { user, pid, arrival } of [own, ...peers]) {
    const key = personKey(user, pid)
    first.set(key, Math.min(arrival ?? Infinity, first.get(key) ?? Infinity))
  }
  const ranked = [...first]
    .sort(([k1, a1], [k2, a2]) => (a1 !== a2 ? Math.sign(a1 - a2) : k1 < k2 ? -1 : +(k1 > k2)))
    .map(([key]) => key)
  const colours = assignColours(ranked)
  const out = new Map<number, string>()
  for (const { user, pid } of [own, ...peers])
    out.set(pid, colours.get(personKey(user, pid))!.light.solid)
  return out
}

/** Everyone else in the room, read from the room's presence against the doc's row/col ids now. */
export function readPresence(
  presence: Pick<RoomPresence, 'peers' | 'ownPid' | 'ownArrival' | 'awareness'>,
  doc: Y.Doc,
  me: string,
  person: (user: string) => Person,
): { users: PresentUser[]; cursors: Map<string, RemoteCursor> } {
  const own: Peer = {
    pid: presence.ownPid,
    user: me,
    arrival: presence.ownArrival,
    idleSince: null,
  }
  const colours = peerColours(presence.peers, own)
  const states = presence.awareness.getStates() as Map<number, { cursor?: unknown }>
  const users: PresentUser[] = []
  const cursors = new Map<string, RemoteCursor>()
  const seen = new Set<string>()
  for (const peer of presence.peers) {
    if (peer.user === me && me !== GUEST_USER) continue // this person's other tabs
    const { fullName, image } = nameOf(peer.user, peer.pid, person)
    const first = fullName.trim().split(/\s+/)[0] || fullName
    const initials = initialsOf(fullName)
    const color = colours.get(peer.pid)!
    const sel = selectionFromIds(doc, readSavedSelection(states.get(peer.pid)?.cursor))
    if (sel) {
      cursors.set(String(peer.pid), {
        row: sel.r0,
        col: sel.c0,
        range: { r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1 },
        subSheet: sel.sheet,
        color,
        fullName,
        firstName: first,
        initials,
      })
    }
    const key = personKey(peer.user, peer.pid)
    if (seen.has(key)) continue
    seen.add(key)
    users.push({
      user: key,
      full_name: fullName,
      first_name: first,
      initials,
      user_image: image,
      color,
      sub_sheet: sel?.sheet ?? null,
    })
  }
  return { users, cursors }
}

/** Publish this tab's selection (the room sends it only while the tab can write). */
export function sendSelection(
  presence: Pick<RoomPresence, 'awareness'>,
  doc: Y.Doc,
  sel: Selection | null,
): void {
  presence.awareness.setLocalStateField('cursor', selectionToIds(doc, sel))
}
