// Who else has the spreadsheet open, as the editor draws them (like Google
// Sheets): an avatar each in the header, and each editor's selected range
// outlined in their colour on the sheet they are on, with their name on it
// while they move (useRemoteCursorNames).
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
  /**
   * The name label on the range's top-left cell. Everyone whose range starts
   * on that cell shares one label, on the first of their cursors: "Asha, Ravi",
   * or "Asha, Ravi +2" once a third name would make it long. The other cursors there get
   * null, so labels never stack.
   */
  label: string | null
  /** Who the label names, by peer id, so a move by any of them brings it back; empty without a label. */
  labelPeers: string[]
  /**
   * Changes when the peer moves their selection. Made from row/col ids, so
   * rows inserted above them don't count as a move.
   */
  moveKey: string
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

// A label always names two people; past this many characters the rest fold into "+N".
const LABEL_CHARS = 20

// One label's text from the names of the people on its cell, in peer order.
function labelText(names: string[]): string {
  const shown = names.slice(0, 2)
  for (const name of names.slice(2)) {
    if ([...shown, name].join(', ').length > LABEL_CHARS) break
    shown.push(name)
  }
  const rest = names.length - shown.length
  return shown.join(', ') + (rest ? ` +${rest}` : '')
}
interface ReadPresenceResult {
  users: PresentUser[]
  cursors: Map<string, RemoteCursor>
}

/** Everyone else in the room, read from the room's presence against the doc's row/col ids now. */
export function readPresence(
  presence: Pick<RoomPresence, 'peers' | 'ownPid' | 'ownArrival' | 'awareness'>,
  doc: Y.Doc,
  me: string,
  person: (user: string) => Person,
): ReadPresenceResult {
  const own: Peer = {
    pid: presence.ownPid,
    user: me,
    arrival: presence.ownArrival,
    idleSince: null,
  }
  const colours = roomColours(presence.peers, own)
  const states: Map<number, { cursor?: unknown }> = presence.awareness.getStates()
  const users: PresentUser[] = []
  const cursors = new Map<string, RemoteCursor>()
  // Each cell with a label on it: the cursor that carries it, and the name of
  // each person there (a person with two tabs there is named once).
  const cells = new Map<
    string,
    { labelled: RemoteCursor; names: Map<string, string>; peers: string[] }
  >()
  const seen = new Set<string>()
  for (const peer of presence.peers) {
    if (peer.user === me && me !== GUEST_USER) continue // this person's other tabs
    const { fullName, image } = nameOf(peer.user, peer.pid, person)
    const first = fullName.trim().split(/\s+/)[0] || fullName
    const initials = initialsOf(fullName)
    const colour = colours.get(peer.pid)!
    const key = personKey(peer.user, peer.pid)
    const saved = readSavedSelection(states.get(peer.pid)?.cursor)
    const sel = selectionFromIds(doc, saved)
    if (sel) {
      const pid = String(peer.pid)
      const cursor: RemoteCursor = {
        row: sel.r0,
        col: sel.c0,
        range: { r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1 },
        subSheet: sel.sheet,
        colour,
        label: null,
        labelPeers: [],
        moveKey: JSON.stringify(saved),
      }
      cursors.set(pid, cursor)
      // Guests all share the first name "Guest": name them by their tag.
      const name = peer.user === GUEST_USER ? fullName : first
      const cell = JSON.stringify([sel.sheet, sel.r0, sel.c0])
      const onCell = cells.get(cell)
      if (!onCell) {
        cells.set(cell, { labelled: cursor, names: new Map([[key, name]]), peers: [pid] })
      } else {
        onCell.peers.push(pid)
        if (!onCell.names.has(key)) onCell.names.set(key, name)
      }
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
  for (const { labelled, names, peers } of cells.values()) {
    labelled.label = labelText([...names.values()])
    labelled.labelPeers = peers
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
