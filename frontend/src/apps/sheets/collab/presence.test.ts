import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { Peer } from '@/platform/collab'
import { roomColours } from '@/platform/collab/colours'

import { cursorLabels, readPresence, sendSelection, type RemoteCursor } from './presence'
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
    expect(cursors.get('7')!.colour).toBe(users[0]!.colour)
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
    const names = readPresence(p, doc, 'me@x', (u) => ({ fullName: u, image: '' })).users.map(
      (u) => u.full_name,
    )
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    for (const name of names) expect(name).toMatch(/^Guest /)
  })

  it('drops a selection on a deleted sheet, or one that is malformed', () => {
    const doc = sheetDoc()
    const p = presenceOf(doc, [peer(7, 'ann@x', 2), peer(9, 'bob@x', 3)], {
      7: { sheetId: 'gone', r0: 0, c0: 0, r1: 0, c1: 0 },
      9: { sheetId: 'x', r0: -1, c0: '', r1: {}, c1: 0 },
    })
    expect(readPresence(p, doc, 'me@x', names).cursors.size).toBe(0)
  })

  it('gives each person the colour Writer gives them, both shades', () => {
    const doc = sheetDoc()
    const peers = [peer(3, 'ann@x', 2), peer(4, 'bob@x', 3), peer(5, 'Guest', 4)]
    const p = presenceOf(doc, peers, {})
    const own = { pid: 1, user: 'me@x', arrival: 1, idleSince: null }
    const writer = roomColours(peers, own)
    const { users } = readPresence(p, doc, 'me@x', names)
    expect(users.map((u) => u.colour)).toEqual([writer.get(3), writer.get(4), writer.get(5)])
    expect(users[0]!.colour).toHaveProperty('dark.ink')
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

  describe('the name label on a cell', () => {
    type At = { pid: number; user: string; r0: number; c0: number; r1?: number; sheet?: string }

    function labelsOf(people: At[]) {
      const doc = sheetDoc()
      const peers = people.map((x, i) => peer(x.pid, x.user, i + 2))
      const states = Object.fromEntries(
        people.map(({ pid, sheet = 'Sheet1', r0, c0, r1 = r0 }) => [
          pid,
          selectionToIds(doc, { sheet, r0, c0, r1, c1: c0 }),
        ]),
      )
      const full = (u: string) => ({ fullName: u, image: '' })
      const { cursors } = readPresence(presenceOf(doc, peers, states), doc, 'me@x', full)
      return cursorLabels(cursors)
    }

    it('shows both names, comma-separated, when two people are on the same cell', () => {
      const labels = labelsOf([
        { pid: 7, user: 'Asha Rao', r0: 2, c0: 1 },
        { pid: 8, user: 'Ravi Kumar', r0: 2, c0: 1 },
      ])
      expect(labels.get('7')).toEqual({ text: 'Asha, Ravi', title: 'Asha Rao, Ravi Kumar' })
      expect(labels.get('8')).toBeNull()
    })

    it('gives everyone their own label on different cells or sheets', () => {
      const labels = labelsOf([
        { pid: 7, user: 'Asha Rao', r0: 2, c0: 1 },
        { pid: 8, user: 'Ravi Kumar', r0: 3, c0: 1 },
        { pid: 9, user: 'Sam Lee', r0: 2, c0: 1, sheet: 'Sheet2' },
      ])
      expect(labels.get('7')?.text).toBe('Asha')
      expect(labels.get('8')?.text).toBe('Ravi')
      expect(labels.get('9')?.text).toBe('Sam')
    })

    it('ends a long list of names with +N', () => {
      const labels = labelsOf([
        { pid: 7, user: 'Asha Rao', r0: 0, c0: 0 },
        { pid: 8, user: 'Ravindranath K', r0: 0, c0: 0 },
        { pid: 9, user: 'Samantha Lee', r0: 0, c0: 0 },
        { pid: 10, user: 'Bo Chen', r0: 0, c0: 0 },
      ])
      expect(labels.get('7')).toEqual({
        text: 'Asha, Ravindranath +2',
        title: 'Asha Rao, Ravindranath K, Samantha Lee, Bo Chen',
      })
    })

    it('names a person once when two of their tabs are on the cell', () => {
      const labels = labelsOf([
        { pid: 7, user: 'Asha Rao', r0: 0, c0: 0 },
        { pid: 8, user: 'Asha Rao', r0: 0, c0: 0 },
        { pid: 9, user: 'Ravi Kumar', r0: 0, c0: 0 },
      ])
      expect(labels.get('7')?.text).toBe('Asha, Ravi')
    })

    it('drops a name at once when its person moves away', () => {
      const ravi = { pid: 8, user: 'Ravi Kumar', r0: 2, c0: 1 }
      const together = labelsOf([{ pid: 7, user: 'Asha Rao', r0: 2, c0: 1 }, ravi])
      const apart = labelsOf([{ pid: 7, user: 'Asha Rao', r0: 4, c0: 0 }, ravi])
      expect(together.get('7')?.text).toBe('Asha, Ravi')
      expect(apart.get('7')?.text).toBe('Asha')
      expect(apart.get('8')).toEqual({ text: 'Ravi', title: 'Ravi Kumar' })
    })

    it('counts a range as on the cell where its label sits, its top-left', () => {
      const labels = labelsOf([
        { pid: 7, user: 'Asha Rao', r0: 2, c0: 1, r1: 6 },
        { pid: 8, user: 'Ravi Kumar', r0: 2, c0: 1 },
      ])
      expect(labels.get('7')?.text).toBe('Asha, Ravi')
      expect(cursorLabels(new Map<string, RemoteCursor>()).size).toBe(0)
    })
  })
})
