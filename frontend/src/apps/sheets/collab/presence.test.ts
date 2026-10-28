import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { Peer } from '@/platform/collab'

import { peerColours, readPresence, sendSelection } from './presence'
import { addSheet, axis, initDoc } from './schema'
import { readSavedSelection, selectionToIds } from './selection'

function sheetDoc() {
  const doc = new Y.Doc()
  initDoc(doc)
  const id = addSheet(doc, 'Sheet1')
  addSheet(doc, 'Sheet2')
  // Rows 1–10 and columns A–E have ids.
  axis(doc, id, 'rows').ensure(9)
  axis(doc, id, 'cols').ensure(4)
  return doc
}

const peer = (pid: number, user: string, arrival: number): Peer => ({
  pid,
  user,
  arrival,
  idleSince: null,
})

function presenceOf(doc: Y.Doc, peers: Peer[], cursors: Record<number, unknown>) {
  const states = new Map<number, unknown>(
    Object.entries(cursors).map(([pid, cursor]) => [Number(pid), { cursor }]),
  )
  return {
    peers,
    ownPid: 1,
    ownArrival: 1,
    awareness: { getStates: () => states } as never,
    doc,
  }
}

const names = (user: string) => ({ fullName: user === 'ann@x' ? 'Ann Lee' : user, image: '' })

describe('presence', () => {
  it("draws a peer's selected range in their colour, with their name", () => {
    const doc = sheetDoc()
    const cursor = selectionToIds(doc, { sheet: 'Sheet1', r0: 2, c0: 1, r1: 4, c1: 2 })
    const p = presenceOf(doc, [peer(7, 'ann@x', 2)], { 7: cursor })
    const { users, cursors } = readPresence(p, doc, 'me@x', names)
    expect(cursors.get('7')).toMatchObject({
      row: 2,
      col: 1,
      range: { r0: 2, c0: 1, r1: 4, c1: 2 },
      subSheet: 'Sheet1',
      fullName: 'Ann Lee',
      firstName: 'Ann',
      initials: 'AL',
    })
    expect(users).toEqual([
      expect.objectContaining({ user: 'ann@x', full_name: 'Ann Lee', sub_sheet: 'Sheet1' }),
    ])
    expect(cursors.get('7')!.color).toBe(users[0]!.color)
  })

  it('keeps the box on its cells when rows are inserted above it', () => {
    const doc = sheetDoc()
    const cursor = selectionToIds(doc, { sheet: 'Sheet1', r0: 5, c0: 0, r1: 5, c1: 0 })
    const sheetId = doc.getArray<string>('sheets').get(0)
    axis(doc, sheetId, 'rows').insert(0, 2)
    const p = presenceOf(doc, [peer(7, 'ann@x', 2)], { 7: cursor })
    expect(readPresence(p, doc, 'me@x', names).cursors.get('7')?.row).toBe(7)
  })

  it('shows a viewer as an avatar without a box', () => {
    const doc = sheetDoc()
    const p = presenceOf(doc, [peer(8, 'viewer@x', 3)], {})
    const { users, cursors } = readPresence(p, doc, 'me@x', names)
    expect(users.map((u) => u.user)).toEqual(['viewer@x'])
    expect(users[0]!.sub_sheet).toBeNull()
    expect(cursors.size).toBe(0)
  })

  it("leaves out this person's other tabs, and shows one avatar per person", () => {
    const doc = sheetDoc()
    const p = presenceOf(doc, [peer(2, 'me@x', 1), peer(3, 'ann@x', 2), peer(4, 'ann@x', 5)], {})
    expect(readPresence(p, doc, 'me@x', names).users.map((u) => u.user)).toEqual(['ann@x'])
  })

  it('tells two guests apart', () => {
    const doc = sheetDoc()
    const p = presenceOf(doc, [peer(36, 'Guest', 2), peer(37, 'Guest', 3)], {})
    const users = readPresence(p, doc, 'me@x', names).users
    expect(users.map((u) => u.full_name)).toEqual(['Guest 10', 'Guest 11'])
  })

  it('drops a selection on a deleted sheet, or one that is malformed', () => {
    const doc = sheetDoc()
    const p = presenceOf(doc, [peer(7, 'ann@x', 2), peer(9, 'bob@x', 3)], {
      7: { sheetId: 'gone', r0: 0, c0: 0, r1: 0, c1: 0 },
      9: { sheetId: 'x', r0: -1, c0: '', r1: {}, c1: 0 },
    })
    expect(readPresence(p, doc, 'me@x', names).cursors.size).toBe(0)
  })

  it('gives each person the same colour in every tab', () => {
    const ann = peer(3, 'ann@x', 2)
    const bob = peer(4, 'bob@x', 3)
    const me = peer(1, 'me@x', 1)
    const fromMe = peerColours([ann, bob], me)
    const fromAnn = peerColours([me, bob], ann)
    expect(fromAnn.get(4)).toBe(fromMe.get(4))
    expect(fromAnn.get(1)).toBe(fromMe.get(1))
    expect(new Set(fromMe.values()).size).toBe(3)
  })

  it("sends this tab's selection by ids", () => {
    const doc = sheetDoc()
    const setLocalStateField = vi.fn()
    sendSelection({ awareness: { setLocalStateField } as never }, doc, {
      sheet: 'Sheet2',
      r0: 0,
      c0: 0,
      r1: 0,
      c1: 0,
    })
    const [field, sent] = setLocalStateField.mock.calls[0]!
    expect(field).toBe('cursor')
    // Sheet2 has no row ids yet: its ends stay positions.
    expect(readSavedSelection(sent)).toMatchObject({ r0: 0, c0: 0, r1: 0, c1: 0 })
  })
})
