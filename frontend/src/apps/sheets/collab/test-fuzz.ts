// Fuzz kit: three tabs make random edits (cells, rows/cols, sheets, side
// stores), syncing at random moments, then sync fully. After every step each
// tab's IronCalc must hold what its own doc says; at the end every tab must
// have the same inputs, shown values, side stores and sheets. Edits do what
// the editor does, including remapping the side stores on a row/col change
// (engine/ref-remap.ts).
//
// Imported by tests only (glue.fuzz.test.ts, undo.fuzz.test.ts).

/// <reference types="node" />

import { expect } from 'vitest'
import { encodeStateAsUpdate, encodeStateVector } from 'yjs'

import { deleteMap, insertMap, moveMap } from '../engine/ref-remap'
import { cellId, parseCellId } from '../utils/cells'
import { cmd, displays, docInputs, inputs, openTab, storeState, sync, type Tab } from './test-tabs'

// mulberry32: small, seeded, and uses all 32 bits (a low-bit LCG cycles fast).
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  return { next, int, pick: <T>(xs: readonly T[]): T => xs[int(xs.length)]! }
}

const ROWS = 8
const COLS = 5

export type Rng = ReturnType<typeof rng>

// Remap the positional side stores as the editor does on a row/col change.
function remap(t: Tab, axis: 'rows' | 'cols', map: (i: number) => number | null) {
  const s = t.stores
  for (const store of [s.formats, s.comments, s.condFormat, s.validation]) {
    if (axis === 'rows') store.remapRows(map, 'Sheet1')
    else store.remapCols(map, 'Sheet1')
  }
}

async function randomEdit(t: Tab, r: Rng, made: Set<string>): Promise<void> {
  const row = r.int(ROWS)
  const col = r.int(COLS)
  const at = cellId(row, col)
  const sheet = 'Sheet1'
  switch (r.int(14)) {
    case 0:
    case 1:
    case 2:
      t.glue.dispatch(
        cmd('setInput', { sheet, row: row + 1, col: col + 1, input: String(r.int(100)) }),
      )
      break
    case 3: {
      const ref = cellId(r.int(ROWS), r.int(COLS))
      t.glue.dispatch(
        cmd('setInput', { sheet, row: row + 1, col: col + 1, input: `=${ref}*2+SUM(A1:B3)` }),
      )
      break
    }
    case 4:
      t.glue.dispatch(
        cmd('clearContents', {
          sheet,
          range: { r1: row + 1, c1: col + 1, r2: row + 2, c2: col + 1 },
        }),
      )
      break
    case 5: {
      const count = 1 + r.int(2)
      t.glue.dispatch(cmd('insertRows', { sheet, row: row + 1, count }))
      remap(t, 'rows', insertMap(row, count))
      break
    }
    case 6:
      t.glue.dispatch(cmd('deleteRows', { sheet, row: row + 1, count: 1 }))
      remap(t, 'rows', deleteMap(row, 1))
      break
    case 7: {
      const delta = r.pick([-2, -1, 1, 2])
      if (row + delta < 0) break
      t.glue.dispatch(cmd('moveRows', { sheet, row: row + 1, count: 1, delta }))
      remap(t, 'rows', moveMap(row, delta < 0 ? row + delta : row + delta + 1, 1))
      break
    }
    case 8:
      if (r.int(2)) {
        t.glue.dispatch(cmd('insertColumns', { sheet, col: col + 1, count: 1 }))
        remap(t, 'cols', insertMap(col, 1))
      } else {
        t.glue.dispatch(cmd('deleteColumns', { sheet, col: col + 1, count: 1 }))
        remap(t, 'cols', deleteMap(col, 1))
      }
      break
    case 9:
      t.stores.formats.applyToRange([at], r.int(2) ? { bold: true } : { fill: '#ff0' }, sheet)
      break
    case 10:
      if (r.int(3)) t.stores.comments.addReply(at, { text: `note ${r.int(9)}`, ts: 1 }, sheet)
      else t.stores.comments.clear(at, sheet)
      break
    case 11:
      if (r.int(2))
        t.stores.condFormat.addRule(
          {
            range: { r0: row, c0: col, r1: row + 2, c1: col },
            condition: { type: 'gt', value: '5' },
          },
          sheet,
        )
      else t.stores.charts.add({ sourceSheet: sheet, sourceRange: `A1:B${row + 1}` })
      break
    case 12: {
      const name = `${t.name}${r.int(1000)}`
      if (!t.client.sheets.includes(name)) {
        t.glue.dispatch(cmd('addSheet', { name }))
        t.glue.dispatch(cmd('setInput', { sheet: name, row: 1, col: 1, input: '=Sheet1!A1' }))
        made.add(name)
      }
      break
    }
    case 13: {
      const mine = [...made].filter((n) => t.client.sheets.includes(n))
      if (!mine.length) break
      const from = r.pick(mine)
      const to = `${from}x`
      if (t.client.sheets.includes(to)) break
      t.glue.dispatch(cmd('renameSheet', { sheet: from, name: to }))
      made.delete(from)
      made.add(to)
      break
    }
  }
  await t.glue.commit()
}

// The per-step check reads a fixed window: IronCalc's usedCells scans every
// row of a sheet, which is too slow to run after each step.
const WINDOW = { rows: 60, cols: 15 }

async function windowInputs(t: Tab): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const sheet of t.client.sheets) {
    const res = await t.client.readViewport({
      sheet,
      r1: 1,
      c1: 1,
      r2: WINDOW.rows,
      c2: WINDOW.cols,
      includeInputs: true,
    })
    res.inputs?.forEach((row, r) =>
      row.forEach((input, c) => {
        if (input) out[`${sheet}!${cellId(r, c)}`] = input
      }),
    )
  }
  return out
}

function inWindow(cells: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cells).filter(([key]) => {
      const p = parseCellId(key.slice(key.lastIndexOf('!') + 1))
      return p && p.row < WINDOW.rows && p.col < WINDOW.cols
    }),
  )
}

/**
 * One fuzz run. `act`, when given, gets a turn before each random edit and
 * returns true if it did something instead (undo.fuzz.test.ts: undo/redo).
 */
export async function runFuzz(
  seed: number,
  steps: number,
  opts: { setup?: (t: Tab) => void; act?: (t: Tab, r: Rng) => Promise<boolean> } = {},
): Promise<void> {
  const r = rng(seed)
  const a = await openTab('A')
  const b = await openTab('B', a.doc)
  const c = await openTab('C', a.doc)
  const tabs = [a, b, c]
  for (const t of tabs) opts.setup?.(t)
  const made = new Map(tabs.map((t) => [t, new Set<string>()]))
  for (let i = 0; i < steps; i++) {
    const t = r.pick(tabs)
    if (!(await opts.act?.(t, r))) await randomEdit(t, r, made.get(t)!)
    if (r.next() < 0.3) {
      // A partial sync: one tab's updates reach one other tab.
      const from = r.pick(tabs)
      const to = r.pick(tabs.filter((x) => x !== from))
      for (const m of from.outbox.splice(0)) to.glue.receive(m)
      // What `to` received is now part of its doc: pass it on later too.
      await to.glue.settled()
    }
    // Each tab's IronCalc holds what its own doc says, after every step.
    for (const t of tabs) {
      await t.glue.settled()
      expect({ seed, step: i, tab: t.name, cells: await windowInputs(t) }).toEqual({
        seed,
        step: i,
        tab: t.name,
        cells: inWindow(docInputs(t)),
      })
    }
  }
  // Everything still has to reach everyone (the outboxes miss what was relayed).
  for (const t of tabs) t.outbox.length = 0
  await fullSync(tabs)
  for (const t of tabs)
    expect({ seed, tab: t.name, end: await inputs(t) }).toEqual({
      seed,
      tab: t.name,
      end: docInputs(t),
    })
  const [first, ...rest] = tabs
  const want = {
    sheets: first!.client.sheets,
    inputs: await inputs(first!),
    displays: await displays(first!),
    stores: storeState(first!),
  }
  for (const t of rest) {
    expect({ seed, tab: t.name, sheets: t.client.sheets }).toEqual({
      seed,
      tab: t.name,
      sheets: want.sheets,
    })
    expect({ seed, tab: t.name, inputs: await inputs(t) }).toEqual({
      seed,
      tab: t.name,
      inputs: want.inputs,
    })
    expect({ seed, tab: t.name, displays: await displays(t) }).toEqual({
      seed,
      tab: t.name,
      displays: want.displays,
    })
    expect({ seed, tab: t.name, stores: storeState(t) }).toEqual({
      seed,
      tab: t.name,
      stores: want.stores,
    })
  }
}

// Bring every doc up to date with every other, by state vectors (what the
// server does for a tab that reconnects).
async function fullSync(tabs: Tab[]): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (const from of tabs) {
      for (const to of tabs) {
        if (from === to) continue
        to.glue.receive(encodeStateAsUpdate(from.doc, encodeStateVector(to.doc)))
        await to.glue.settled()
      }
    }
  }
  await sync(...tabs)
}
