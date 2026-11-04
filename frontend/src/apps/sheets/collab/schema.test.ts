import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  addSheet,
  axis,
  cellKey,
  initDoc,
  lineKey,
  parseCellKey,
  parseLineKey,
  parseStateKey,
  removeSheet,
  ROOT,
  roots,
  SCHEMA_VERSION,
  stateKey,
} from './schema'

/** Send every update each doc is missing to every other doc. */
function sync(...docs: Y.Doc[]): void {
  for (const a of docs) {
    for (const b of docs) {
      if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
    }
  }
}

/** Two synced docs sharing one sheet. Fixed client ids, so a test can run both tie-break orders. */
function pair(idA = 1, idB = 2): { a: Y.Doc; b: Y.Doc; sid: string } {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.clientID = idA
  b.clientID = idB
  initDoc(a)
  const sid = addSheet(a, 'Sheet1')
  sync(a, b)
  return { a, b, sid }
}

const COL = 0

/** Type `value` at (row, COL), growing the id lists like the glue will. */
function write(doc: Y.Doc, sid: string, row: number, value: string): void {
  doc.transact(() => {
    const key = cellKey(sid, axis(doc, sid, 'rows').ensure(row), axis(doc, sid, 'cols').ensure(COL))
    roots(doc).inputs.set(key, value)
  })
}

/** value → row position it shows at now (-1 = its row is gone). */
function where(doc: Y.Doc, sid: string): Record<string, number> {
  const rows = axis(doc, sid, 'rows')
  const out: Record<string, number> = {}
  for (const [key, value] of roots(doc).inputs.entries()) {
    const parts = parseCellKey(key)
    if (parts) out[value] = rows.posOf(parts.rowId)
  }
  return out
}

const BOTH_ORDERS: [number, number][] = [
  [1, 2],
  [2, 1],
]

describe('keys', () => {
  it('builds and parses cell keys', () => {
    expect(cellKey('s1', 'e2', 'e3')).toBe('s1:e2:e3')
    expect(parseCellKey('s1:e2:e3')).toEqual({ sheetId: 's1', rowId: 'e2', colId: 'e3' })
  })

  it('builds and parses row/col and sheet-state keys', () => {
    expect(lineKey('s1', 'e4')).toBe('s1:e4')
    expect(parseLineKey('s1:e4')).toEqual({ sheetId: 's1', id: 'e4' })
    expect(stateKey('s1', 'merges')).toBe('s1:merges')
    expect(parseStateKey('s1:merges')).toEqual({ sheetId: 's1', store: 'merges' })
  })

  it('rejects malformed keys', () => {
    expect(parseCellKey('s1:e2')).toBeNull()
    expect(parseCellKey('s1:e2:e3:x')).toBeNull()
    expect(parseCellKey('s1::e3')).toBeNull()
    expect(parseLineKey('s1')).toBeNull()
    expect(parseStateKey('s1:a:b')).toBeNull()
  })
})

describe('doc and sheets', () => {
  it('stamps the schema version', () => {
    const doc = new Y.Doc()
    initDoc(doc)
    expect(SCHEMA_VERSION).toBe(1)
    expect(roots(doc).meta.get('schemaVersion')).toBe(1)
  })

  it('never downgrades a doc written by a newer schema', () => {
    const doc = new Y.Doc()
    roots(doc).meta.set('schemaVersion', 2)
    initDoc(doc)
    expect(roots(doc).meta.get('schemaVersion')).toBe(2)
  })

  it('uses the decided root names', () => {
    expect(Object.values(ROOT).sort()).toEqual(
      [
        'meta',
        'sheets',
        'sheetMeta',
        'rows',
        'cols',
        'inputs',
        'formats',
        'rowFormats',
        'colFormats',
        'charts',
        'pivots',
        'condFormats',
        'validations',
        'comments',
        'slicers',
        'names',
        'sheetState',
        'tails',
      ].sort(),
    )
  })

  it('adds a sheet with its name and empty row/col lists, in tab order', () => {
    const doc = new Y.Doc()
    const s1 = addSheet(doc, 'Sheet1')
    const s0 = addSheet(doc, 'First', 0)
    const r = roots(doc)
    expect(r.sheets.toArray()).toEqual([s0, s1])
    expect(r.sheetMeta.get(s1)).toEqual({ name: 'Sheet1' })
    expect(r.rows.get(s1)?.length).toBe(0)
    expect(r.cols.get(s1)?.length).toBe(0)
    expect(s1).not.toContain(':')
  })

  it('removes a sheet and everything keyed by it, in one transaction', () => {
    const doc = new Y.Doc()
    const keep = addSheet(doc, 'Keep')
    const sid = addSheet(doc, 'Gone')
    write(doc, sid, 3, 'x')
    write(doc, keep, 0, 'kept')
    const r = roots(doc)
    r.formats.set(cellKey(sid, 'e1', 'e1'), { bold: true })
    r.sheetState.set(stateKey(sid, 'merges'), [])
    let transactions = 0
    doc.on('afterTransaction', () => transactions++)
    removeSheet(doc, sid)
    expect(transactions).toBe(1)
    expect(r.sheets.toArray()).toEqual([keep])
    expect(r.sheetMeta.has(sid) || r.rows.has(sid) || r.cols.has(sid)).toBe(false)
    expect([...r.inputs.values()]).toEqual(['kept'])
    expect(r.formats.size + r.sheetState.size).toBe(0)
    expect([...r.tails.keys()].some((k) => k.startsWith(sid + ':'))).toBe(false)
  })
})

describe('axis: one sheet, one tab', () => {
  it('grows with predictable ids only up to the row asked for', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    const rows = axis(doc, sid, 'rows')
    expect(rows.length).toBe(0)
    expect(rows.idAt(0)).toBeUndefined()
    expect(rows.ensure(2)).toBe('e3')
    expect(rows.length).toBe(3)
    expect([rows.idAt(0), rows.idAt(1), rows.idAt(2)]).toEqual(['e1', 'e2', 'e3'])
    expect(rows.ensure(1)).toBe('e2')
    expect(rows.length).toBe(3)
    expect(rows.posOf('e3')).toBe(2)
    expect(rows.posOf('nope')).toBe(-1)
  })

  it('inserts new ids and shifts the rows below, keeping their cells', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    write(doc, sid, 4, 'five')
    const rows = axis(doc, sid, 'rows')
    const added = rows.insert(1, 2)
    expect(added).toHaveLength(2)
    expect(rows.length).toBe(7)
    expect(rows.idAt(1)).toBe(added[0])
    expect(where(doc, sid)).toEqual({ five: 6 })
    for (const id of added) expect(id).not.toMatch(/^e\d+$|[.:]/)
  })

  it('ignores inserts and deletes past the last row with an id', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    write(doc, sid, 2, 'x')
    const rows = axis(doc, sid, 'rows')
    expect(rows.insert(3, 5)).toEqual([])
    expect(rows.remove(10, 2)).toEqual([])
    expect(rows.length).toBe(3)
  })

  it('removes the ids and their cells, inputs and formats, in one transaction', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    write(doc, sid, 0, 'a')
    write(doc, sid, 1, 'b')
    write(doc, sid, 2, 'c')
    const r = roots(doc)
    const rows = axis(doc, sid, 'rows')
    const bId = rows.idAt(1)!
    r.formats.set(cellKey(sid, bId, 'e1'), { bold: true })
    r.rowFormats.set(lineKey(sid, bId), { fill: 'red' })
    let transactions = 0
    doc.on('afterTransaction', () => transactions++)
    expect(rows.remove(1, 1)).toEqual([bId])
    expect(transactions).toBe(1)
    expect(where(doc, sid)).toEqual({ a: 0, c: 1 })
    expect(r.formats.size + r.rowFormats.size).toBe(0)
  })

  it('removing a column removes its cells and column format', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    const r = roots(doc)
    const rowId = axis(doc, sid, 'rows').ensure(0)
    const cols = axis(doc, sid, 'cols')
    const [c0, c1] = [cols.ensure(0), cols.ensure(1)]
    r.inputs.set(cellKey(sid, rowId, c0), 'A1')
    r.inputs.set(cellKey(sid, rowId, c1), 'B1')
    r.colFormats.set(lineKey(sid, c1), { width: 200 })
    cols.remove(1, 1)
    expect([...r.inputs.values()]).toEqual(['A1'])
    expect(r.colFormats.size).toBe(0)
  })

  it('undo of a delete brings back the row and its cells together', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    write(doc, sid, 0, 'a')
    write(doc, sid, 1, 'b')
    const r = roots(doc)
    const undo = new Y.UndoManager([r.rows, r.inputs, r.formats, r.rowFormats], {
      captureTimeout: 0,
    })
    axis(doc, sid, 'rows').remove(0, 1)
    expect(where(doc, sid)).toEqual({ b: 0 })
    undo.undo()
    expect(where(doc, sid)).toEqual({ a: 0, b: 1 })
  })

  it('undo of growth shrinks the list back (the kept index does not go stale)', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    const r = roots(doc)
    const undo = new Y.UndoManager([r.rows, r.inputs], { captureTimeout: 0 })
    write(doc, sid, 1, 'a')
    write(doc, sid, 4, 'b')
    const rows = axis(doc, sid, 'rows')
    expect(rows.length).toBe(5)
    undo.undo()
    expect(rows.length).toBe(2)
    expect(rows.posOf('e5')).toBe(-1)
    expect(where(doc, sid)).toEqual({ a: 1 })
  })

  it('never reuses a deleted tail id', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    const rows = axis(doc, sid, 'rows')
    rows.ensure(299)
    rows.remove(299, 1)
    expect(rows.ensure(299)).not.toBe('e300')
  })

  it('names tails after an inserted last row from that row', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    const rows = axis(doc, sid, 'rows')
    rows.ensure(1)
    const [mid] = rows.insert(1, 1)
    rows.remove(2, 1) // the inserted row is now the last one
    expect(rows.ensure(3)).toBe(`${mid}.2`)
  })

  it('observers already see the new positions when growth fires them', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    const rows = axis(doc, sid, 'rows')
    const seen: [number, number][] = []
    roots(doc).rows.observeDeep(() => seen.push([rows.length, rows.posOf('e5')]))
    rows.ensure(4) // on its own, not inside a caller's transaction
    expect(seen).toEqual([[5, 4]])
  })

  it('sees its own changes inside one transaction', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    const rows = axis(doc, sid, 'rows')
    doc.transact(() => {
      rows.ensure(4)
      const [id] = rows.insert(0, 1)
      expect(rows.posOf(id!)).toBe(0)
      expect(rows.length).toBe(6)
      rows.remove(0, 1)
      expect(rows.idAt(0)).toBe('e1')
      rows.move(0, 1, 2)
      expect(rows.idAt(2)).toBe('e1')
    })
  })

  it('moves a block of rows, which keep their cells (IronCalc moveRows: start → start + delta)', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    for (const [i, v] of ['a', 'b', 'c', 'd', 'e'].entries()) write(doc, sid, i, v)
    const rows = axis(doc, sid, 'rows')
    rows.move(0, 2, 3)
    expect(where(doc, sid)).toEqual({ c: 0, d: 1, e: 2, a: 3, b: 4 })
    rows.move(4, 1, -4)
    expect(where(doc, sid)).toEqual({ b: 0, c: 1, d: 2, e: 3, a: 4 })
  })

  it('moving into rows past the end grows the list to reach them', () => {
    const doc = new Y.Doc()
    const sid = addSheet(doc, 'Sheet1')
    write(doc, sid, 0, 'a')
    axis(doc, sid, 'rows').move(0, 1, 5)
    expect(where(doc, sid)).toEqual({ a: 5 })
    expect(axis(doc, sid, 'rows').length).toBe(6)
  })
})

describe.each(BOTH_ORDERS)('two tabs racing (client ids %i, %i)', (idA, idB) => {
  it('an edit racing a move stays with its row', () => {
    const { a, b, sid } = pair(idA, idB)
    for (const [i, v] of ['a', 'b', 'c'].entries()) write(a, sid, i, v)
    sync(a, b)
    axis(a, sid, 'rows').move(0, 1, 2)
    roots(b).inputs.set(cellKey(sid, axis(b, sid, 'rows').idAt(0)!, 'e2'), 'next to a')
    sync(a, b)
    expect(axis(a, sid, 'rows').ids()).toEqual(axis(b, sid, 'rows').ids())
    expect(where(a, sid)).toMatchObject({ a: 2, 'next to a': 2 })
  })

  it('concurrent inserts at one spot: both rows kept, same order everywhere', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 9, 'r10')
    sync(a, b)
    axis(a, sid, 'rows').insert(3, 1)
    axis(b, sid, 'rows').insert(3, 1)
    sync(a, b)
    expect(axis(a, sid, 'rows').length).toBe(12)
    expect(axis(a, sid, 'rows').ids()).toEqual(axis(b, sid, 'rows').ids())
    expect(where(a, sid).r10).toBe(11)
  })

  it('an edit racing an insert lands on the row it was typed in', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 4, 'old')
    sync(a, b)
    write(a, sid, 2, 'mine')
    axis(b, sid, 'rows').insert(0, 1)
    sync(a, b)
    expect(where(a, sid).mine).toBe(3)
    expect(where(b, sid).mine).toBe(3)
  })

  it('two people growing into the same far row land on the same row', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 199, 'x')
    sync(a, b)
    write(a, sid, 299, 'a300')
    write(b, sid, 299, 'b300')
    sync(a, b)
    expect(axis(a, sid, 'rows').length).toBe(300)
    // Same cell, same moment: one value wins, on row 300.
    const w = where(a, sid)
    expect(Object.keys(w)).toHaveLength(2)
    expect(w.a300 ?? w.b300).toBe(299)
  })

  it('growth from different lengths still agrees on the far row', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 199, 'x')
    sync(a, b)
    write(b, sid, 249, 'b250')
    write(a, sid, 299, 'a300')
    write(b, sid, 299, 'b300')
    sync(a, b)
    const w = where(a, sid)
    expect(axis(a, sid, 'rows').length).toBe(300)
    expect(w.b250).toBe(249)
    expect(w.a300 ?? w.b300).toBe(299)
  })

  it('insert-then-grow racing a plain grow keeps every row where its author meant', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 199, 'x')
    sync(a, b)
    axis(a, sid, 'rows').insert(5, 1) // A inserts near the top...
    write(a, sid, 299, 'a300') // ...then types in row 300 (counted after the insert)
    write(b, sid, 200, 'b201') // B hasn't seen the insert
    write(b, sid, 299, 'b300')
    sync(a, b)
    // B's rows shift down by one; A's row 300 stays row 300.
    expect(where(a, sid)).toEqual({ x: 200, a300: 299, b201: 201, b300: 300 })
  })

  it('delete wins over an edit racing it; the edit becomes an invisible orphan', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 5, 'v')
    sync(a, b)
    axis(a, sid, 'rows').remove(5, 1)
    write(b, sid, 5, 'edit')
    sync(a, b)
    expect(where(a, sid)).toEqual({ edit: -1 })
    expect(where(b, sid)).toEqual({ edit: -1 })
  })

  it('an orphan stays hidden when the sheet grows back over its row', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 299, 'v')
    sync(a, b)
    axis(a, sid, 'rows').remove(299, 1)
    write(b, sid, 299, 'orphan')
    sync(a, b)
    write(a, sid, 299, 'new')
    sync(a, b)
    expect(where(a, sid)).toEqual({ orphan: -1, new: 299 })
  })

  it('deleting the last row racing a grow shifts the grown rows up', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 199, 'last')
    sync(a, b)
    axis(a, sid, 'rows').remove(199, 1)
    write(b, sid, 249, 'b250')
    sync(a, b)
    expect(where(a, sid)).toEqual({ b250: 248 })
  })

  it('a duplicated id counts once, and deleting it removes every copy', () => {
    const { a, b, sid } = pair(idA, idB)
    axis(a, sid, 'rows').ensure(4)
    axis(b, sid, 'rows').ensure(4)
    sync(a, b)
    const rows = axis(a, sid, 'rows')
    expect(rows.length).toBe(5)
    rows.remove(2, 1)
    expect(rows.ids()).toEqual(['e1', 'e2', 'e4', 'e5'])
    sync(a, b)
    expect(axis(b, sid, 'rows').ids()).toEqual(['e1', 'e2', 'e4', 'e5'])
  })

  it('positions follow updates from the other tab', () => {
    const { a, b, sid } = pair(idA, idB)
    write(a, sid, 2, 'x')
    sync(a, b)
    const rowsB = axis(b, sid, 'rows')
    expect(where(b, sid).x).toBe(2)
    axis(a, sid, 'rows').insert(0, 2)
    sync(a, b)
    expect(rowsB.length).toBe(5)
    expect(where(b, sid).x).toBe(4)
  })
})

describe('fuzz: three tabs, random edits, syncing often', () => {
  function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // ~1 s alone; slower when the IronCalc glue tests run beside it.
  it('always converges, and rows anyone has seen never swap order', { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(seed)
      const pick = (n: number) => Math.floor(rnd() * n)
      const docs = [1, 2, 3].map((id) => {
        const d = new Y.Doc()
        d.clientID = id
        return d
      })
      const sid = addSheet(docs[0]!, 'Sheet1')
      sync(...docs)
      const seen: string[][] = []
      for (let op = 0; op < 300; op++) {
        for (const d of docs) seen.push(axis(d, sid, 'rows').ids())
        const d = docs[pick(3)]!
        const rows = axis(d, sid, 'rows')
        const x = rnd()
        if (x < 0.2) write(d, sid, pick(rows.length + 8), `v${seed}.${op}`)
        else if (x < 0.25) rows.insert(pick(rows.length + 1), 1 + pick(3))
        else if (x < 0.3) rows.remove(pick(rows.length + 1), 1 + pick(3))
        else sync(...docs)
      }
      sync(...docs)
      const final = axis(docs[0]!, sid, 'rows').ids()
      for (const d of docs) {
        expect(axis(d, sid, 'rows').ids()).toEqual(final)
        expect(roots(d).inputs.toJSON()).toEqual(roots(docs[0]!).inputs.toJSON())
      }
      const at = new Map(final.map((id, i) => [id, i]))
      for (const view of seen) {
        const order = view.map((id) => at.get(id)).filter((i) => i !== undefined)
        expect(order).toEqual([...order].sort((p, q) => p - q))
      }
    }
  })
})
