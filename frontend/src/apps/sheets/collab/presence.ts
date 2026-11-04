// Who else has the spreadsheet open, as the editor draws them (like Google
// Sheets): an avatar each in the header, and each editor's selected range
// outlined in their colour on the sheet they are on, their name on hover.
// Colours are Writer's (platform/collab/colours), so a person has one colour
// across Suite.
// Viewers get an avatar but no box: the room sends a tab's selection only
// while it can write.
//
// A tab sends its selection by row/col ids (selection.ts), so a peer's box
// stays on its cells when someone inserts rows above it.

import type * as Y from 'yjs'

import type { Peer, RoomPresence } from '@/platform/collab'
import { GUEST_USER, personKey, roomColours, type PeerColour } from '@/platform/collab/colours'

import { readSavedSelection, selectionFromIds, selectionToIds, type Selection } from './selection'

export { GUEST_USER }

/** An avatar in the header (SheetTopbarActions, SheetTabsBar). */
export interface PresentUser {
  user: string
  full_name: string
  first_name: string
  initials: string
  user_image: string
  colour: PeerColour
  /** The sheet they are on; null for a viewer, whose selection isn't sent. */
  sub_sheet: string | null
}

/** A peer's selected range, drawn over the grid (0-based). */
export interface RemoteCursor {
  row: number
  col: number
  range: { r0: number; c0: number; r1: number; c1: number }
  subSheet: string
  colour: PeerColour
  /** Who the tab belongs to: one person can have several tabs. */
  person: string
  fullName: string
  firstName: string
  initials: string
}

/** A person's name and picture; their user id until it is known. */
export interface Person {
  fullName: string
  image: string
}

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
  const colours = roomColours(presence.peers, own)
  const states = presence.awareness.getStates() as Map<number, { cursor?: unknown }>
  const users: PresentUser[] = []
  const cursors = new Map<string, RemoteCursor>()
  const seen = new Set<string>()
  for (const peer of presence.peers) {
    if (peer.user === me && me !== GUEST_USER) continue // this person's other tabs
    const { fullName, image } = nameOf(peer.user, peer.pid, person)
    const first = fullName.trim().split(/\s+/)[0] || fullName
    const initials = initialsOf(fullName)
    const colour = colours.get(peer.pid)!
    const key = personKey(peer.user, peer.pid)
    const sel = selectionFromIds(doc, readSavedSelection(states.get(peer.pid)?.cursor))
    if (sel) {
      cursors.set(String(peer.pid), {
        row: sel.r0,
        col: sel.c0,
        range: { r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1 },
        subSheet: sel.sheet,
        colour,
        person: key,
        fullName,
        firstName: first,
        initials,
      })
    }
    if (seen.has(key)) continue
    seen.add(key)
    users.push({
      user: key,
      full_name: fullName,
      first_name: first,
      initials,
      user_image: image,
      colour,
      sub_sheet: sel?.sheet ?? null,
    })
  }
  return { users, cursors }
}

/** A name label: what it reads, and everyone's full name on hover. */
export interface CursorLabel {
  text: string
  title: string
}

// Past this many characters a label's other names fold into "+N".
const LABEL_CHARS = 20

/**
 * The label on each cursor (keyed as `cursors`). Everyone whose selection
 * starts on the same cell shares one label, on the first of their cursors:
 * "Asha, Ravi", or "Asha, Ravi +2" once the names get long. The other
 * cursors on that cell get null, so labels never stack.
 */
export function cursorLabels(cursors: Map<string, RemoteCursor>): Map<string, CursorLabel | null> {
  const byCell = new Map<string, { key: string; names: Map<string, RemoteCursor> }>()
  const out = new Map<string, CursorLabel | null>()
  for (const [key, cursor] of cursors) {
    const cell = JSON.stringify([cursor.subSheet, cursor.range.r0, cursor.range.c0])
    const group = byCell.get(cell)
    if (group) {
      if (!group.names.has(cursor.person)) group.names.set(cursor.person, cursor)
      out.set(key, null)
    } else {
      byCell.set(cell, { key, names: new Map([[cursor.person, cursor]]) })
    }
  }
  for (const { key, names } of byCell.values()) {
    const people = [...names.values()]
    const shown = [people[0]!.firstName]
    for (const p of people.slice(1)) {
      if ([...shown, p.firstName].join(', ').length > LABEL_CHARS) break
      shown.push(p.firstName)
    }
    const rest = people.length - shown.length
    out.set(key, {
      text: shown.join(', ') + (rest ? ` +${rest}` : ''),
      title: people.map((p) => p.fullName).join(', '),
    })
  }
  return out
}

/** Publish this tab's selection (the room sends it only while the tab can write). */
export function sendSelection(
  presence: Pick<RoomPresence, 'awareness'>,
  doc: Y.Doc,
  sel: Selection | null,
): void {
  presence.awareness.setLocalStateField('cursor', selectionToIds(doc, sel))
}
